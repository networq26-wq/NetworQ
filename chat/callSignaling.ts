import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export interface CallPeerState {
  inCall: boolean;
  isCalling: boolean;
  isReceiving: boolean;
  callerName?: string;
  callerId?: string;
  muted: boolean;
}

export class WebRtcCallManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private channel: RealtimeChannel | null = null;
  private onStateChange: (state: CallPeerState) => void;
  private currentUserId: string;
  private partnerId: string;
  private partnerName: string;

  private state: CallPeerState = {
    inCall: false,
    isCalling: false,
    isReceiving: false,
    muted: false,
  };

  constructor(opts: {
    supabase: SupabaseClient;
    currentUserId: string;
    partnerId: string;
    partnerName: string;
    onStateChange: (state: CallPeerState) => void;
  }) {
    this.currentUserId = opts.currentUserId;
    this.partnerId = opts.partnerId;
    this.partnerName = opts.partnerName;
    this.onStateChange = opts.onStateChange;

    const [u1, u2] = this.currentUserId < this.partnerId
      ? [this.currentUserId, this.partnerId]
      : [this.partnerId, this.currentUserId];

    this.channel = opts.supabase.channel(`call:${u1}_${u2}`);
    this.setupSignaling();
  }

  private update(next: Partial<CallPeerState>) {
    this.state = { ...this.state, ...next };
    this.onStateChange(this.state);
  }

  private setupSignaling() {
    if (!this.channel) return;
    this.channel
      .on("broadcast", { event: "call_signal" }, async ({ payload }) => {
        if (!payload || payload.senderId === this.currentUserId) return;

        if (payload.type === "offer") {
          this.update({ isReceiving: true, callerName: this.partnerName, callerId: this.partnerId });
          (this as any).pendingOffer = payload.offer;
        } else if (payload.type === "answer") {
          if (this.pc) {
            await this.pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
            this.update({ inCall: true, isCalling: false });
          }
        } else if (payload.type === "candidate") {
          if (this.pc && payload.candidate) {
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (e) {
              console.warn("ICE error", e);
            }
          }
        } else if (payload.type === "hangup") {
          this.cleanup();
        }
      })
      .subscribe();
  }

  private createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.channel?.send({
          type: "broadcast",
          event: "call_signal",
          payload: { senderId: this.currentUserId, type: "candidate", candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      const audio = new Audio();
      audio.srcObject = this.remoteStream;
      audio.play().catch(() => {});
    };

    return pc;
  }

  async startCall() {
    try {
      this.update({ isCalling: true });
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.pc = this.createPeerConnection();

      this.localStream.getTracks().forEach((t) => this.pc?.addTrack(t, this.localStream!));

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.channel?.send({
        type: "broadcast",
        event: "call_signal",
        payload: { senderId: this.currentUserId, type: "offer", offer },
      });
    } catch (err: any) {
      console.warn("Could not start call:", err);
      this.cleanup();
    }
  }

  async acceptCall() {
    try {
      const offer = (this as any).pendingOffer;
      if (!offer) return;

      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.pc = this.createPeerConnection();

      this.localStream.getTracks().forEach((t) => this.pc?.addTrack(t, this.localStream!));

      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.channel?.send({
        type: "broadcast",
        event: "call_signal",
        payload: { senderId: this.currentUserId, type: "answer", answer },
      });

      this.update({ inCall: true, isReceiving: false, isCalling: false });
    } catch (err: any) {
      console.warn("Could not accept call:", err);
      this.cleanup();
    }
  }

  toggleMute() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.update({ muted: !audioTrack.enabled });
      }
    }
  }

  hangup() {
    this.channel?.send({
      type: "broadcast",
      event: "call_signal",
      payload: { senderId: this.currentUserId, type: "hangup" },
    });
    this.cleanup();
  }

  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    (this as any).pendingOffer = null;
    this.update({ inCall: false, isCalling: false, isReceiving: false, muted: false });
  }

  destroy() {
    this.cleanup();
    this.channel?.unsubscribe();
  }
}
