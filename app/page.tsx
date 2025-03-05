"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Send, Video } from "lucide-react";

// Dynamic import untuk CameraPreview
const CameraPreview = dynamic(() => import("./components/CameraPreview"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-black rounded-lg animate-pulse flex items-center justify-center">
      <div className="text-white text-center space-y-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto" />
        <p>Memuat kamera...</p>
      </div>
    </div>
  ),
});

// Helper function to create message components
const HumanMessage = ({ text }: { text: string }) => (
  <div className="flex gap-3 items-start">
    <Avatar className="h-8 w-8">
      <AvatarImage src="/avatars/human.svg" alt="Human" />
      <AvatarFallback>HN</AvatarFallback>
    </Avatar>
    <div className="flex-1 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-zinc-900">You</p>
      </div>
      <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800">
        {text}
      </div>
    </div>
  </div>
);

const GeminiMessage = ({ text }: { text: string }) => (
  <div className="flex gap-3 items-start">
    <Avatar className="h-8 w-8 text-slate-800">
      <AvatarImage
        src="/avatars/ai.svg"
        alt="AI"
        className="h-full w-full px-1 py-1"
      />
      <AvatarFallback>AI</AvatarFallback>
    </Avatar>
    <div className="flex-1 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-zinc-900">Gemini</p>
      </div>
      <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
        {text}
      </div>
    </div>
  </div>
);

export default function Home() {
  const [messages, setMessages] = useState<
    { type: "human" | "gemini"; text: string }[]
  >([]);
  const [inputText, setInputText] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraPreviewRef = useRef<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showCamera, setShowCamera] = useState(true);
  const touchStartX = useRef<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isLoading, setIsLoading] = useState(false);

  // Deteksi mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Gesture handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX.current;

    if (Math.abs(deltaX) > 50) {
      // Minimal swipe distance
      if (deltaX > 0 && !showCamera) {
        setShowCamera(true); // Swipe right to show camera
      } else if (deltaX < 0 && showCamera) {
        setShowCamera(false); // Swipe left to hide camera
      }
    }
  };

  // Error handling untuk mobile
  const handleDeviceError = useCallback((error: Error) => {
    let errorMessage = "";

    if (error.name === "NotAllowedError") {
      errorMessage =
        "Mohon izinkan akses kamera dan mikrofon untuk menggunakan fitur ini";
    } else if (error.name === "NotFoundError") {
      errorMessage =
        "Tidak dapat menemukan kamera atau mikrofon pada perangkat Anda";
    } else {
      errorMessage = "Terjadi kesalahan saat mengakses perangkat media";
    }

    // Tampilkan pesan error
    alert(errorMessage);
  }, []);

  // Fungsi untuk menangani input pengguna
  const handleUserInput = () => {
    if (inputText.trim() === "") return;

    // Tambahkan pesan pengguna ke daftar pesan
    setMessages((prev) => [...prev, { type: "human", text: inputText }]);

    // Kirim pesan ke Gemini
    if (cameraPreviewRef.current && cameraPreviewRef.current.sendTextMessage) {
      cameraPreviewRef.current.sendTextMessage(inputText);
    } else if (
      typeof window !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).sendGeminiTextMessage
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).sendGeminiTextMessage(inputText);
    } else {
      console.error(
        "Tidak dapat mengirim pesan ke Gemini: fungsi sendTextMessage tidak tersedia"
      );
    }

    // Reset input
    setInputText("");
  };

  // Fungsi untuk menangani pesan dari pengguna yang dikirim melalui CameraPreview
  const handleUserMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { type: "human", text }]);
  }, []);

  // Fungsi untuk menangani transkripsi dari Gemini dan pengguna
  const handleTranscription = useCallback(
    (transcription: string, isUserMessage?: boolean) => {
      if (isUserMessage) {
        setMessages((prev) => [
          ...prev,
          { type: "human", text: transcription },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { type: "gemini", text: transcription },
        ]);
      }
    },
    []
  );

  // Auto-scroll ke pesan terbaru
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div
      className="min-h-screen bg-zinc-50"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={`flex flex-col md:flex-row gap-4 p-4 md:p-8 h-[100vh] ${
          isMobile ? "relative" : ""
        }`}
      >
        {/* Camera Preview Container */}
        <div
          className={`
          ${
            isMobile
              ? showCamera
                ? "fixed inset-0 z-50 bg-black"
                : "hidden"
              : "w-[640px]"
          }
          ${!isMobile && "relative"}
        `}
        >
          <CameraPreview
            ref={cameraPreviewRef}
            onTranscription={handleTranscription}
            onUserMessage={handleUserMessage}
            onError={handleDeviceError}
          />
          {isMobile && (
            <Button
              onClick={() => setShowCamera(false)}
              className="absolute top-4 right-4 bg-white/20 hover:bg-white/30"
              aria-label="Close camera"
            >
              Close
            </Button>
          )}
        </div>

        {/* Chat Container */}
        <div
          className={`
            flex flex-col bg-white rounded-lg shadow-sm
            ${isMobile ? "flex-1" : "w-[640px]"}
          `}
          role="log"
          aria-label="Chat messages"
        >
          {/* Messages Area */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6">
              <GeminiMessage text="Hi! I'm Gemini. I can see and hear you. Let's chat!" />
              {messages.map((message, index) =>
                message.type === "human" ? (
                  <HumanMessage key={`msg-${index}`} text={message.text} />
                ) : (
                  <GeminiMessage key={`msg-${index}`} text={message.text} />
                )
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="p-4 border-t border-zinc-200">
            <div className="flex gap-2">
              {isMobile && (
                <Button
                  onClick={() => setShowCamera(true)}
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  aria-label="Open camera"
                  role="switch"
                  aria-checked={showCamera}
                >
                  <Video className="h-4 w-4" />
                </Button>
              )}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUserInput();
                }}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Message input"
              />
              <Button
                onClick={handleUserInput}
                size="icon"
                className="rounded-full shrink-0"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
