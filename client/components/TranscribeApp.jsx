import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import Button from "./Button";

export default function TranscribeApp() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  
  const peerConnection = useRef(null);
  const audioStream = useRef(null);

  async function startSession() {
    try {
      setConnectionStatus("connecting");
      
      // Get a transcription token for OpenAI Realtime API
      const tokenResponse = await fetch("/transcribe-token");
      const data = await tokenResponse.json();
      const EPHEMERAL_KEY = data.value;

      // Create a peer connection
      const pc = new RTCPeerConnection();
      
      // Log ICE gathering state
      pc.onicegatheringstatechange = () => {
        console.log("ICE gathering state:", pc.iceGatheringState);
      };
      
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("ICE candidate:", event.candidate.type);
        } else {
          console.log("ICE gathering complete");
        }
      };

      // Add local audio track for microphone input - matching the server's expected format
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // Disable processing for transcription
          noiseSuppression: false,
          autoGainControl: true,
          sampleRate: 24000,  // Match the server's expected 24kHz
          channelCount: 1     // Mono audio
        }
      });
      
      audioStream.current = ms;
      const audioTrack = ms.getTracks()[0];
      
      // Log actual audio settings
      const audioSettings = audioTrack.getSettings();
      console.log("Audio track settings:", audioSettings);
      
      // Add the track directly to peer connection
      pc.addTrack(audioTrack, ms);

      // Set up data channel for receiving transcription events
      const dc = pc.createDataChannel("oai-events");
      setDataChannel(dc);

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      console.log("Created SDP offer");

      // For transcription sessions, use the /calls endpoint without model parameter
      const baseUrl = "https://api.openai.com/v1/realtime/calls";
      const sdpResponse = await fetch(baseUrl, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`HTTP error! status: ${sdpResponse.status}`);
      }

      const sdp = await sdpResponse.text();
      const answer = { type: "answer", sdp };
      await pc.setRemoteDescription(answer);

      // Monitor peer connection state
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setConnectionStatus("error");
        }
      };
      
      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
      };
      
      peerConnection.current = pc;
      setConnectionStatus("connected");
    } catch (error) {
      console.error("Failed to start session - Full error:", error);
      console.error("Error stack:", error.stack);
      setConnectionStatus("error");
      alert(`Session failed: ${error.message}`);
    }
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    if (audioStream.current) {
      audioStream.current.getTracks().forEach(track => track.stop());
      audioStream.current = null;
    }

    if (peerConnection.current) {
      peerConnection.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    setConnectionStatus("disconnected");
    peerConnection.current = null;
  }

  // Clear transcript
  function clearTranscript() {
    setTranscript("");
    setEvents([]);
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      console.log("Setting up data channel event listeners");
      
      // Handle incoming transcription messages
      dataChannel.addEventListener("message", (e) => {
        console.log("📨 Received message:", e.data);
        const event = JSON.parse(e.data);
        const timestamp = new Date().toLocaleTimeString();
        event.timestamp = timestamp;
        
        setEvents((prev) => [event, ...prev]);

        // Handle transcription events - transcription sessions use different event types
        if (event.type === "transcription.audio_transcript.done") {
          // Final transcription for an audio segment
          if (event.text || event.transcript) {
            const text = event.text || event.transcript;
            setTranscript(prev => {
              const newText = prev ? prev + " " + text : text;
              return newText.trim();
            });
          }
        } else if (event.type === "transcription.audio_transcript.delta") {
          // Incremental transcription update
          if (event.text || event.delta) {
            const text = event.text || event.delta;
            setTranscript(prev => {
              const newText = prev ? prev + " " + text : text;
              return newText.trim();
            });
          }
        } else if (event.type === "transcription.text.done") {
          // Complete transcription text
          if (event.text || event.transcript) {
            const text = event.text || event.transcript;
            setTranscript(prev => {
              const newText = prev ? prev + " " + text : text;
              return newText.trim();
            });
          }
        } else if (event.type === "conversation.item.input_audio_transcription.completed") {
          // Fallback for conversation-style transcription event
          if (event.transcript) {
            setTranscript(prev => {
              const newText = prev ? prev + " " + event.transcript : event.transcript;
              return newText.trim();
            });
          }
        } else if (event.type === "conversation.item.input_audio_transcription.failed") {
          // Transcription failed - log the error with details
          console.error("Transcription failed:", event);
          console.error("Full error object:", JSON.stringify(event, null, 2));
          if (event.error) {
            console.error("Error details:", event.error);
            if (event.error.message) {
              console.error("Error message:", event.error.message);
            }
            if (event.error.code) {
              console.error("Error code:", event.error.code);
            }
          }
        } else if (event.type === "input_audio_buffer.speech_started") {
          // Speech detection started
          console.log("Speech detected, transcribing...");
        } else if (event.type === "input_audio_buffer.speech_stopped") {
          // Speech detection stopped
          console.log("Speech ended");
        } else if (event.type === "error") {
          // General error event
          console.error("Session error:", event.error);
        }
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
        console.log("✅ Data channel opened - transcription session ready");
        console.log("Data channel state:", dataChannel.readyState);
        // Note: For transcription sessions, configuration is handled server-side
      });

      dataChannel.addEventListener("error", (error) => {
        console.error("❌ Data channel error:", error);
        console.error("Full error object:", error);
        setConnectionStatus("error");
      });

      dataChannel.addEventListener("close", () => {
        console.log("Data channel closed");
        setIsSessionActive(false);
        setConnectionStatus("disconnected");
      });
      
      console.log("Data channel initial state:", dataChannel.readyState);
    }
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>Realtime Transcription</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-sm font-medium ${
              connectionStatus === "connected" ? "bg-green-100 text-green-700" :
              connectionStatus === "connecting" ? "bg-yellow-100 text-yellow-700" :
              connectionStatus === "error" ? "bg-red-100 text-red-700" :
              "bg-gray-100 text-gray-700"
            }`}>
              {connectionStatus}
            </span>
            <a href="/" className="text-sm text-blue-600 hover:underline">
              Back to Console
            </a>
          </div>
        </div>
      </nav>
      
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <div className="flex flex-col h-full">
          {/* Control Panel */}
          <section className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-4">
              {!isSessionActive ? (
                <Button onClick={startSession} className="px-6 py-3">
                  🎙️ Start Transcription Session
                </Button>
              ) : (
                <Button onClick={stopSession} className="px-6 py-3 bg-red-500 hover:bg-red-600">
                  ⏹️ Stop Session
                </Button>
              )}
              {transcript && (
                <Button onClick={clearTranscript} className="px-4 py-2 bg-gray-400 hover:bg-gray-500">
                  Clear Transcript
                </Button>
              )}
            </div>
            
            {isSessionActive && (
              <div className="mt-4 text-sm text-gray-600">
                <span className="flex items-center gap-2">
                  <span className="animate-pulse">🔴</span> Transcribing audio... Speak into your microphone
                </span>
              </div>
            )}
          </section>

          {/* Transcript Display */}
          <section className="flex-1 flex">
            <div className="flex-1 p-6">
              <h2 className="text-lg font-semibold mb-4">Transcript</h2>
              <div className="bg-gray-50 rounded-lg p-6 min-h-[400px] max-h-[600px] overflow-y-auto">
                {transcript ? (
                  <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {transcript.trim()}
                  </p>
                ) : (
                  <p className="text-gray-400 italic">
                    {isSessionActive ? 
                      "Listening for audio..." : 
                      "Start a session to begin transcription"
                    }
                  </p>
                )}
              </div>
              
              {/* Copy button */}
              {transcript && (
                <div className="mt-4">
                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(transcript);
                      alert("Transcript copied to clipboard!");
                    }}
                    className="px-4 py-2"
                  >
                    📋 Copy Transcript
                  </Button>
                </div>
              )}
            </div>

            {/* Event Log Panel */}
            <div className="w-96 border-l border-gray-200 p-6 bg-gray-50">
              <h2 className="text-lg font-semibold mb-4">Event Log</h2>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {events.length > 0 ? (
                  events.map((event, index) => (
                    <div key={index} className="bg-white p-3 rounded border border-gray-200 text-xs">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-mono text-blue-600">{event.type}</span>
                        <span className="text-gray-400">{event.timestamp}</span>
                      </div>
                      {(event.transcript || event.text) && (
                        <div className="mt-2 p-2 bg-green-50 rounded">
                          <span className="text-green-700">"{event.transcript || event.text}"</span>
                        </div>
                      )}
                      {event.error && (
                        <div className="mt-2 p-2 bg-red-50 rounded">
                          <span className="text-red-700">{
                            typeof event.error === 'object' ? 
                              (event.error.message || JSON.stringify(event.error)) : 
                              event.error
                          }</span>
                        </div>
                      )}
                      {event.item && event.item.id && (
                        <div className="text-xs text-gray-500 mt-1">
                          Item: {event.item.id}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-400 text-sm">No events yet...</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
