// One live call's media: WebRTC peer connection + signalling on the private call:<u1>_<u2> channel
// (only these two connected, unblocked people can join it — Realtime Authorization).
//
// Handshake: the callee accepts, joins, and says "ready" (repeating until heard); the caller answers
// "ready" with an offer; the callee answers. ICE candidates trickle both ways and are queued until the
// remote description is set. Either side can hang up.
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getCallMedia } from "./media";

type Signal =
  | { type: "ready" }
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "hangup" };

export interface SessionEvents {
  onLocalStream: (s: MediaStream) => void;
  onRemoteStream: (s: MediaStream) => void;
  onConnected: () => void;
  onFailed: (message: string) => void;
  onRemoteHangup: () => void;
}

export class CallSession {
  private pc: RTCPeerConnection | null = null;
  private channel: RealtimeChannel | null = null;
  private local: MediaStream | null = null;
  private remote: MediaStream | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private readyTimer: any = null;
  private offered = false;
  private connected = false;
  private closed = false;
  private disconnectTimer: any = null;
  facing: "user" | "environment" = "user";

  constructor(
    private supabase: SupabaseClient,
    private opts: { callId: string; me: string; peer: string; role: "caller" | "callee"; video: boolean; iceServers: RTCIceServer[] },
    private ev: SessionEvents
  ) {}

  private topic() {
    const [a, b] = this.opts.me < this.opts.peer ? [this.opts.me, this.opts.peer] : [this.opts.peer, this.opts.me];
    return `call:${a}_${b}`;
  }

  private send(sig: Signal) {
    this.channel?.send({ type: "broadcast", event: "rtc", payload: { callId: this.opts.callId, from: this.opts.me, ...sig } });
  }

  /** Get mic/camera, join the signalling channel and start the handshake. Throws MediaError with a friendly message. */
  async start() {
    this.local = await getCallMedia(this.opts.video, this.facing);
    if (this.closed) return this.stopTracks();
    this.ev.onLocalStream(this.local);

    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    this.pc = pc;
    this.local.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => e.candidate && this.send({ type: "candidate", candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      if (!this.remote) this.remote = e.streams[0] || new MediaStream();
      if (!e.streams[0]) this.remote.addTrack(e.track);
      this.ev.onRemoteStream(this.remote);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        clearTimeout(this.disconnectTimer);
        clearInterval(this.readyTimer);
        if (!this.connected) {
          this.connected = true;
          this.ev.onConnected();
        }
      } else if (st === "failed") {
        this.ev.onFailed(
          this.connected
            ? "The call dropped. Check your connection and call again."
            : "Couldn't connect the call — this network blocks direct calls. Try Wi-Fi or mobile data."
        );
      } else if (st === "disconnected") {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => pc.connectionState === "disconnected" && this.ev.onFailed("The call dropped. Check your connection and call again."), 10_000);
      }
    };

    await new Promise<void>((resolve, reject) => {
      const ch = this.supabase.channel(this.topic(), { config: { private: true, broadcast: { self: false } } });
      this.channel = ch;
      ch.on("broadcast", { event: "rtc" }, ({ payload }) => this.onSignal(payload)).subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Couldn't reach the call service. Check your connection."));
      });
    });

    // Callee: keep saying "ready" until the caller's offer arrives (the caller may still be joining)
    if (this.opts.role === "callee") {
      this.send({ type: "ready" });
      this.readyTimer = setInterval(() => !this.offered && this.send({ type: "ready" }), 1500);
    }
  }

  private async onSignal(p: any) {
    if (!p || p.callId !== this.opts.callId || p.from === this.opts.me || !this.pc || this.closed) return;
    const pc = this.pc;
    try {
      if (p.type === "ready" && this.opts.role === "caller") {
        if (this.connected || pc.remoteDescription) return; // already answered
        if (pc.signalingState === "have-local-offer" && pc.localDescription) {
          this.send({ type: "offer", sdp: pc.localDescription.toJSON() }); // repeat ready → repeat the same offer
          return;
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send({ type: "offer", sdp: pc.localDescription!.toJSON() });
      } else if (p.type === "offer" && this.opts.role === "callee") {
        if (pc.remoteDescription) {
          // repeated offer: our answer may have been lost — send it again
          if (pc.localDescription?.type === "answer") this.send({ type: "answer", sdp: pc.localDescription.toJSON() });
          return;
        }
        this.offered = true;
        clearInterval(this.readyTimer);
        await pc.setRemoteDescription(p.sdp);
        await this.flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ type: "answer", sdp: pc.localDescription!.toJSON() });
      } else if (p.type === "answer" && this.opts.role === "caller") {
        if (pc.signalingState !== "have-local-offer") return; // late duplicate
        await pc.setRemoteDescription(p.sdp);
        await this.flushCandidates();
      } else if (p.type === "candidate" && p.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(p.candidate).catch(() => {});
        else this.pending.push(p.candidate);
      } else if (p.type === "hangup") {
        this.ev.onRemoteHangup();
      }
    } catch (e) {
      console.warn("[call] signalling error", e);
    }
  }

  private async flushCandidates() {
    const list = this.pending.splice(0);
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  setMuted(muted: boolean) {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setCameraOff(off: boolean) {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !off));
  }

  /** Front ↔ back camera without renegotiating. */
  async flipCamera() {
    if (!this.local || !this.pc) return;
    const next = this.facing === "user" ? "environment" : "user";
    const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false });
    const track = fresh.getVideoTracks()[0];
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!track || !sender) return fresh.getTracks().forEach((t) => t.stop());
    const old = this.local.getVideoTracks()[0];
    track.enabled = old ? old.enabled : true;
    await sender.replaceTrack(track);
    if (old) {
      this.local.removeTrack(old);
      old.stop();
    }
    this.local.addTrack(track);
    this.facing = next;
    this.ev.onLocalStream(this.local);
  }

  private stopTracks() {
    this.local?.getTracks().forEach((t) => t.stop());
  }

  /** Leave the call. `notify` tells the other side to hang up too. */
  close(notify: boolean) {
    if (this.closed) return;
    this.closed = true;
    if (notify) this.send({ type: "hangup" });
    clearInterval(this.readyTimer);
    clearTimeout(this.disconnectTimer);
    this.stopTracks();
    try {
      this.pc?.close();
    } catch {}
    this.pc = null;
    const ch = this.channel;
    this.channel = null;
    // give the hangup a moment to go out before leaving the channel
    if (ch) setTimeout(() => this.supabase.removeChannel(ch), notify ? 400 : 0);
  }
}
