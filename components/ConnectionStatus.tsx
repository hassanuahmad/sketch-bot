import React from "react";
import { Wifi, WifiOff } from "lucide-react";

interface ConnectionStatusProps {
  isConnected: boolean;
  carName?: string;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  isConnected,
  carName = "Car 1",
}) => {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-card border border-border rounded-lg font-mono text-sm">
      <div className="flex items-center gap-2">
        {isConnected ? (
          <Wifi className="w-4 h-4 text-status-connected" />
        ) : (
          <WifiOff className="w-4 h-4 text-status-disconnected" />
        )}
        <span className="font-semibold text-foreground">{carName}</span>
      </div>

      <div className="flex items-center gap-2">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected
              ? "bg-green-500 animate-pulse-slow glow-green"
              : "bg-status-disconnected glow-red"
          }`}
        />
        <span
          className={`text-xs uppercase tracking-wider ${
            isConnected ? "text-status-connected" : "text-status-disconnected"
          }`}
        >
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>
    </div>
  );
};

export default ConnectionStatus;
