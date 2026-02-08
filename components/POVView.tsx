import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

interface POVViewProps {
  isActive: boolean;
}

const POVView: React.FC<POVViewProps> = ({ isActive }) => {
  if (!isActive) return null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [error, setError] = useState<string>("");
  const [hasAccess, setHasAccess] = useState(false);

  const hasDevices = devices.length > 0;
  const selectedDevice = useMemo(
    () => devices.find((d) => d.deviceId === selectedId),
    [devices, selectedId]
  );

  useEffect(() => {
    let mounted = true;

    const updateDevices = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = list.filter((d) => d.kind === "videoinput");
        if (!mounted) return;
        setDevices(videoInputs);
        if (!selectedId && videoInputs[0]) {
          setSelectedId(videoInputs[0].deviceId);
        }
      } catch (err) {
        if (!mounted) return;
        setError("Unable to list cameras. Check permissions.");
        setStatus("error");
      }
    };

    updateDevices();
    navigator.mediaDevices.addEventListener("devicechange", updateDevices);
    return () => {
      mounted = false;
      navigator.mediaDevices.removeEventListener("devicechange", updateDevices);
    };
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject instanceof MediaStream) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access not supported in this browser.");
      setStatus("error");
      return;
    }
    if (!selectedId) {
      setError("No camera selected.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: selectedId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setHasAccess(true);
      setStatus("ready");
      // Refresh labels after permission is granted.
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "videoinput"));
    } catch (err) {
      setError("Unable to start camera. Check permissions and selection.");
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[500px] aspect-square bg-canvas-bg border border-border rounded-sm relative overflow-hidden">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-10" style={{
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(210, 20%, 92%) 2px, hsl(210, 20%, 92%) 3px)",
      }} />

      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />

      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-20">
        <select
          className="h-8 px-2 text-xs bg-secondary border border-border rounded-sm text-foreground"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {!hasDevices && (
            <option value="">No cameras found</option>
          )}
          {devices.map((d, idx) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${idx + 1}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="h-8 px-3 text-xs bg-primary text-primary-foreground rounded-sm hover:opacity-90 disabled:opacity-50"
          onClick={startCamera}
          disabled={!hasDevices || status === "loading"}
        >
          {hasAccess ? "Restart" : "Enable"}
        </button>
        <div className="ml-auto flex items-center gap-2 px-2 py-1 bg-secondary rounded-full">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse-slow" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
            Live
          </span>
        </div>
      </div>

      {status !== "ready" && (
        <div className="flex flex-col items-center gap-4 text-muted-foreground z-10">
          <div className="relative">
            <Camera className="w-12 h-12" />
            <Loader2 className="w-5 h-5 absolute -bottom-1 -right-1 animate-spin text-primary" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">Robot Camera Feed</p>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              {status === "error"
                ? error || "Camera error."
                : "Click Enable to start the camera."}
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-full">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-slow" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-primary">
              Drawing in progress
            </span>
          </div>
        </div>
      )}

      {/* Corner markers */}
      <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-primary/40" />
      <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-primary/40" />
      <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-primary/40" />
      <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-primary/40" />
    </div>
  );
};

export default POVView;
