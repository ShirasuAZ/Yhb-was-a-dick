import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import type {
  ActionAck,
  AuthResult,
  ClientToServerEvents,
  CreateRoomResult,
  EmoteMessage,
  JoinRoomResult,
  RoomState,
  ServerToClientEvents
} from "../../shared/protocol.ts";

export class TestClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  state: RoomState | null = null;
  username = "";
  password = "";
  authToken = "";
  replacedMessage: string | null = null;
  emotes: EmoteMessage[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly emoteListeners = new Set<() => void>();

  constructor(url: string) {
    this.socket = io(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false
    });
    this.socket.on("room_state", (state) => {
      this.state = state;
      for (const listener of this.listeners) {
        listener();
      }
    });
    this.socket.on("session_replaced", (payload) => {
      this.replacedMessage = payload.message;
    });
    this.socket.on("emote", (message) => {
      this.emotes.push(message);
      for (const listener of this.emoteListeners) {
        listener();
      }
    });
  }

  async connect(): Promise<void> {
    if (this.socket.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Socket connection timed out"));
      }, 5000);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  emitAck<TPayload, TResult = unknown>(
    event: keyof ClientToServerEvents,
    payload: TPayload
  ): Promise<ActionAck<TResult>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Ack timed out for ${String(event)}`));
      }, 5000);
      const callback = (result: ActionAck<TResult>): void => {
        clearTimeout(timer);
        resolve(result);
      };
      (
        this.socket as unknown as {
          emit: (
            name: string,
            body: unknown,
            ack: (result: ActionAck<TResult>) => void
          ) => void;
        }
      ).emit(event, payload, callback);
    });
  }

  async createRoom(name: string): Promise<CreateRoomResult> {
    const result = await this.emitAck<{ name: string }, CreateRoomResult>(
      "create_room",
      { name }
    );
    if (!result.ok || !result.data) {
      throw new Error(result.message ?? "create_room failed");
    }
    return result.data;
  }

  async register(
    username: string,
    password = "TestPass123!"
  ): Promise<AuthResult> {
    const result = await this.emitAck<
      { username: string; email: string; password: string },
      AuthResult
    >("auth_register", { username, email: `${username}@example.com`, password });
    if (!result.ok || !result.data) {
      throw new Error(result.message ?? "register failed");
    }
    this.username = username;
    this.password = password;
    this.authToken = result.data.token;
    this.socket.auth = { token: result.data.token };
    return result.data;
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const result = await this.emitAck<
      { username: string; password: string },
      AuthResult
    >("auth_login", { username, password });
    if (!result.ok || !result.data) {
      throw new Error(result.message ?? "login failed");
    }
    this.username = username;
    this.password = password;
    this.authToken = result.data.token;
    this.socket.auth = { token: result.data.token };
    return result.data;
  }

  async joinRoom(roomCode: string, name: string): Promise<JoinRoomResult> {
    const result = await this.emitAck<
      { roomCode: string; name: string },
      JoinRoomResult
    >("join_room", { roomCode, name });
    if (!result.ok || !result.data) {
      throw new Error(result.message ?? "join_room failed");
    }
    return result.data;
  }

  async resume(roomCode: string, token: string): Promise<JoinRoomResult> {
    const result = await this.emitAck<
      { roomCode: string; token: string },
      JoinRoomResult
    >("resume_session", { roomCode, token });
    if (!result.ok || !result.data) {
      throw new Error(result.message ?? "resume_session failed");
    }
    return result.data;
  }

  async setReady(ready: boolean): Promise<ActionAck<unknown>> {
    return this.emitAck("set_ready", {
      ready,
      actionId: randomUUID()
    });
  }

  async startGame(): Promise<ActionAck<unknown>> {
    return this.emitAck("start_game", { actionId: randomUUID() });
  }

  async sendEmote(emoji: string): Promise<ActionAck<unknown>> {
    return this.emitAck("send_emote", {
      emoji,
      actionId: randomUUID()
    });
  }

  async waitForEmote(
    predicate: (message: EmoteMessage) => boolean,
    timeoutMs = 5000
  ): Promise<EmoteMessage> {
    const existing = this.emotes.find(predicate);
    if (existing) {
      return existing;
    }
    return new Promise<EmoteMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.emoteListeners.delete(check);
        reject(new Error("Timed out waiting for emote"));
      }, timeoutMs);
      const check = (): void => {
        const message = this.emotes.find(predicate);
        if (!message) {
          return;
        }
        clearTimeout(timer);
        this.emoteListeners.delete(check);
        resolve(message);
      };
      this.emoteListeners.add(check);
    });
  }

  async waitForState(
    predicate: (state: RoomState) => boolean,
    timeoutMs = 5000
  ): Promise<RoomState> {
    if (this.state && predicate(this.state)) {
      return this.state;
    }
    return new Promise<RoomState>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error("Timed out waiting for room state"));
      }, timeoutMs);
      const check = (): void => {
        if (this.state && predicate(this.state)) {
          clearTimeout(timer);
          this.listeners.delete(check);
          resolve(this.state);
        }
      };
      this.listeners.add(check);
    });
  }

  close(): void {
    this.socket.disconnect();
  }
}

export function actionId(): string {
  return randomUUID();
}
