import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents
} from "@shared/protocol.ts";

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  serverUrl || undefined,
  {
    autoConnect: false,
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    upgrade: true,
    rememberUpgrade: true,
    timeout: 5000,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000
  }
);
