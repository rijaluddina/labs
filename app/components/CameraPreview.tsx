"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
// import { Card, CardContent } from "../../components/ui/card";
import { Button } from "~/components/ui/button";
import { Video, VideoOff, Mic, MicOff } from "lucide-react";
import { GeminiWebSocket } from "../services/geminiWebSocket";
import { Base64 } from "js-base64";
// import { Avatar, AvatarImage, AvatarFallback } from "~/components/ui/avatar";

interface CameraPreviewProps {
  onTranscription: (text: string, isUserMessage?: boolean) => void;
  onUserMessage?: (text: string) => void;
  onError?: (error: Error) => void;
}

// Mengubah komponen menjadi forwardRef agar dapat menerima ref dari parent
const CameraPreview = forwardRef<
  { sendTextMessage: (text: string) => void },
  CameraPreviewProps
>(({ onTranscription, onUserMessage, onError }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const geminiWsRef = useRef<GeminiWebSocket | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const [isAudioSetup, setIsAudioSetup] = useState(false);
  const setupInProgressRef = useRef(false);
  const [isWebSocketReady, setIsWebSocketReady] = useState(false);
  const imageIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [outputAudioLevel, setOutputAudioLevel] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [isLoading, setIsLoading] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cleanupAudio = useCallback(() => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const cleanupWebSocket = useCallback(() => {
    if (geminiWsRef.current) {
      geminiWsRef.current.disconnect();
      geminiWsRef.current = null;
    }
  }, []);

  // Simplify sendAudioData to just send continuously
  const sendAudioData = (b64Data: string) => {
    if (!geminiWsRef.current) return;
    geminiWsRef.current.sendMediaChunk(b64Data, "audio/pcm");
  };

  const handleError = useCallback(
    (err: Error) => {
      setError(err.message);
      onError?.(err);
      setIsLoading(false);
    },
    [onError]
  );

  const toggleMicrophone = useCallback(() => {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !isMicEnabled;
      });
      setIsMicEnabled(!isMicEnabled);
    }
  }, [stream, isMicEnabled]);

  const toggleCamera = async () => {
    if (isStreaming && stream) {
      setIsStreaming(false);
      cleanupWebSocket();
      cleanupAudio();
      stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setStream(null);
    } else {
      try {
        setIsLoading(true);
        setError(null);

        const videoStream = await navigator.mediaDevices
          .getUserMedia({
            video: true,
            audio: false,
          })
          .catch((err) => {
            handleError(err);
            throw err;
          });

        const audioStream = await navigator.mediaDevices
          .getUserMedia({
            audio: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              autoGainControl: true,
              noiseSuppression: true,
            },
          })
          .catch((err) => {
            handleError(err);
            throw err;
          });

        audioContextRef.current = new AudioContext({
          sampleRate: 16000,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = videoStream;
          videoRef.current.muted = true;
        }

        const combinedStream = new MediaStream([
          ...videoStream.getTracks(),
          ...audioStream.getTracks(),
        ]);

        setStream(combinedStream);
        setIsStreaming(true);
        setIsLoading(false);
      } catch (err) {
        console.error("Error accessing media devices:", err);
        handleError(err as Error);
        cleanupAudio();
      }
    }
  };

  // Initialize WebSocket connection
  useEffect(() => {
    if (!isStreaming) {
      setConnectionStatus("disconnected");
      return;
    }

    setConnectionStatus("connecting");
    geminiWsRef.current = new GeminiWebSocket(
      (text) => {
        console.log("Received from Gemini:", text);
      },
      () => {
        console.log(
          "[Camera] WebSocket setup complete, starting media capture"
        );
        setIsWebSocketReady(true);
        setConnectionStatus("connected");
      },
      (isPlaying) => {
        setIsModelSpeaking(isPlaying);
      },
      (level) => {
        setOutputAudioLevel(level);
      },
      onTranscription
    );
    geminiWsRef.current.connect();

    return () => {
      if (imageIntervalRef.current) {
        clearInterval(imageIntervalRef.current);
        imageIntervalRef.current = null;
      }
      cleanupWebSocket();
      setIsWebSocketReady(false);
      setConnectionStatus("disconnected");
    };
  }, [isStreaming, onTranscription, cleanupWebSocket]);

  // Start image capture only after WebSocket is ready
  useEffect(() => {
    if (!isStreaming || !isWebSocketReady) return;

    console.log("[Camera] Starting image capture interval");
    imageIntervalRef.current = setInterval(captureAndSendImage, 1000);

    return () => {
      if (imageIntervalRef.current) {
        clearInterval(imageIntervalRef.current);
        imageIntervalRef.current = null;
      }
    };
  }, [isStreaming, isWebSocketReady]);

  // Update audio processing setup
  useEffect(() => {
    if (
      !isStreaming ||
      !stream ||
      !audioContextRef.current ||
      !isWebSocketReady ||
      isAudioSetup ||
      setupInProgressRef.current
    )
      return;

    let isActive = true;
    setupInProgressRef.current = true;

    const setupAudioProcessing = async () => {
      try {
        const ctx = audioContextRef.current;
        if (!ctx || ctx.state === "closed" || !isActive) {
          setupInProgressRef.current = false;
          return;
        }

        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        await ctx.audioWorklet.addModule("/worklets/audio-processor.js");

        if (!isActive) {
          setupInProgressRef.current = false;
          return;
        }

        audioWorkletNodeRef.current = new AudioWorkletNode(
          ctx,
          "audio-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: {
              sampleRate: 16000,
              bufferSize: 4096, // Larger buffer size like original
            },
            channelCount: 1,
            channelCountMode: "explicit",
            channelInterpretation: "speakers",
          }
        );

        const source = ctx.createMediaStreamSource(stream);
        audioWorkletNodeRef.current.port.onmessage = (event) => {
          if (!isActive || isModelSpeaking) return;
          const { pcmData, level } = event.data;
          setAudioLevel(level);

          const pcmArray = new Uint8Array(pcmData);
          const b64Data = Base64.fromUint8Array(pcmArray);
          sendAudioData(b64Data);
        };

        source.connect(audioWorkletNodeRef.current);
        setIsAudioSetup(true);
        setupInProgressRef.current = false;

        return () => {
          source.disconnect();
          if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.disconnect();
          }
          setIsAudioSetup(false);
        };
      } catch {
        if (isActive) {
          cleanupAudio();
          setIsAudioSetup(false);
        }
        setupInProgressRef.current = false;
      }
    };

    console.log("[Camera] Starting audio processing setup");
    setupAudioProcessing();

    return () => {
      isActive = false;
      setIsAudioSetup(false);
      setupInProgressRef.current = false;
      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, stream, isWebSocketReady, isModelSpeaking]);

  // Capture and send image
  const captureAndSendImage = () => {
    if (!videoRef.current || !videoCanvasRef.current || !geminiWsRef.current)
      return;

    const canvas = videoCanvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Set canvas size to match video
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    // Draw video frame to canvas
    context.drawImage(videoRef.current, 0, 0);

    // Convert to base64 and send
    const imageData = canvas.toDataURL("image/jpeg", 0.8);
    const b64Data = imageData.split(",")[1];
    geminiWsRef.current.sendMediaChunk(b64Data, "image/jpeg");
  };

  // Fungsi untuk mengirim pesan teks ke Gemini
  const sendTextMessage = useCallback(
    (text: string) => {
      if (!geminiWsRef.current || !isWebSocketReady) {
        console.error("Tidak dapat mengirim pesan: WebSocket tidak siap");
        return;
      }

      // Panggil callback onUserMessage jika ada
      if (onUserMessage) {
        onUserMessage(text);
      }

      // Kirim pesan ke Gemini
      console.log("Mengirim pesan teks ke Gemini:", text);
      geminiWsRef.current.sendTextMessage(text);
    },
    [isWebSocketReady, onUserMessage]
  );

  // Ekspos fungsi sendTextMessage melalui ref
  useImperativeHandle(
    ref,
    () => ({
      sendTextMessage,
    }),
    [sendTextMessage]
  );

  // Expose sendTextMessage to window object as fallback
  useEffect(() => {
    // Menambahkan fungsi sendTextMessage ke window agar dapat diakses dari luar
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).sendGeminiTextMessage = sendTextMessage;
    }

    return () => {
      if (typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).sendGeminiTextMessage;
      }
    };
  }, [sendTextMessage]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="space-y-2 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto" />
            <p className="text-sm text-white">Mempersiapkan kamera...</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-500/90 text-white rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Status Koneksi */}
      <div
        className={`
          absolute top-4 left-4 px-3 py-1.5 rounded-full text-sm font-medium
          ${
            connectionStatus === "connected"
              ? "bg-green-500/20 text-green-700"
              : connectionStatus === "connecting"
              ? "bg-yellow-500/20 text-yellow-700"
              : "bg-red-500/20 text-red-700"
          }
        `}
        role="status"
        aria-live="polite"
      >
        {connectionStatus === "connected"
          ? "Connected"
          : connectionStatus === "connecting"
          ? "Connecting..."
          : "Disconnected"}
      </div>

      {/* Video Container */}
      <div
        className="relative flex-1 bg-black rounded-lg overflow-hidden"
        role="region"
        aria-label="Camera preview"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          aria-label="Live camera feed"
        />

        {/* Camera Controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4">
          <Button
            onClick={toggleCamera}
            size="icon"
            variant="secondary"
            className="h-12 w-12 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm"
            aria-label={isStreaming ? "Turn off camera" : "Turn on camera"}
            disabled={isLoading}
          >
            {isStreaming ? (
              <VideoOff className="h-6 w-6" />
            ) : (
              <Video className="h-6 w-6" />
            )}
          </Button>

          <Button
            onClick={toggleMicrophone}
            size="icon"
            variant="secondary"
            className="h-12 w-12 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm"
            aria-label={isMicEnabled ? "Mute microphone" : "Unmute microphone"}
            disabled={!isStreaming || isLoading}
          >
            {isMicEnabled ? (
              <Mic className="h-6 w-6" />
            ) : (
              <MicOff className="h-6 w-6" />
            )}
          </Button>
        </div>

        {/* Audio Level Indicators */}
        <div
          className="absolute bottom-4 left-4 space-y-2"
          role="region"
          aria-label="Audio levels"
        >
          {/* Input Audio Level */}
          <div className="flex items-center gap-2">
            <div
              className="w-20 h-1.5 bg-white/20 rounded-full overflow-hidden"
              role="progressbar"
              aria-label="Input audio level"
              aria-valuenow={audioLevel}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-green-500 transition-all duration-150"
                style={{ width: `${audioLevel}%` }}
              />
            </div>
          </div>

          {/* Output Audio Level */}
          {isModelSpeaking && (
            <div className="flex items-center gap-2">
              <div
                className="w-20 h-1.5 bg-white/20 rounded-full overflow-hidden"
                role="progressbar"
                aria-label="Output audio level"
                aria-valuenow={outputAudioLevel}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-blue-500 transition-all duration-150"
                  style={{ width: `${outputAudioLevel}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden canvas for image capture */}
      <canvas ref={videoCanvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
});

// Tambahkan displayName untuk debugging
CameraPreview.displayName = "CameraPreview";

export default CameraPreview;
