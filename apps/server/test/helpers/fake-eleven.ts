/**
 * Soxta ElevenLabs API (`fetch` o'rnini bosadi): rasmiy API reference'dagi yo'llar va javob shakllari.
 * Audio — haqiqiy WAV (PCM 16-bit mono, sinus), shuning uchun ffprobe/ffmpeg uni o'qiy oladi.
 * Har chaqiruv `calls` ga yoziladi (kesh testlari kredit sarflanmaganini shu bilan tekshiradi).
 */

export const VALID_KEY = "sk_test_valid_key_1234";

/** `duration` soniyalik WAV (16 kHz mono, 440 Hz). */
export function wav(duration: number, frequency = 440): Buffer {
  const rate = 16_000;
  const samples = Math.max(1, Math.round(duration * rate));
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Har belgi 0.06 s (bo'shliq ham), gaplar orasida qo'shimcha 0.3 s pauza. */
export function alignmentFor(text: string) {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  for (const char of text) {
    characters.push(char);
    starts.push(Math.round(t * 1000) / 1000);
    t += 0.06;
    ends.push(Math.round(t * 1000) / 1000);
    if (/[.!?]/.test(char)) t += 0.3;
  }
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

function words(text: string, offset = 0) {
  const out: {
    text: string;
    start: number;
    end: number;
    type: string;
    speaker_id: string;
    logprob: number;
  }[] = [];
  let t = offset;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    out.push({
      text: word,
      start: t,
      end: t + 0.4,
      type: "word",
      speaker_id: "speaker_0",
      logprob: -0.1,
    });
    t += 0.5;
  }
  return out;
}

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  json?: Record<string, unknown>;
  fields?: Record<string, string>;
  files?: string[];
}

export class FakeEleven {
  readonly keys = new Set([VALID_KEY]);
  readonly calls: FakeCall[] = [];
  subscription = {
    tier: "creator",
    status: "active",
    character_count: 1_000,
    character_limit: 100_000,
    next_character_count_reset_unix: 1_790_000_000,
    can_use_instant_voice_cloning: true,
    voice_limit: 30,
  };
  /** Transkript (STT) uchun qaytariladigan matn. */
  sttText = "Salom dunyo bu sinov";
  /** Dubbing status so'rovlari soni: shuncha martadan keyin `dubbed`. */
  dubbingPolls = 1;
  /** Navbatdagi javoblar uchun majburiy xato (status). */
  failNext: { status: number; times: number } | null = null;
  private dubStatus = new Map<string, number>();

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const call: FakeCall = {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    };
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json"))
      call.json = (await request.json()) as Record<string, unknown>;
    else if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      call.fields = {};
      call.files = [];
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") call.fields[name] = value;
        else call.files.push(name);
      }
    }
    this.calls.push(call);
    if (!this.keys.has(request.headers.get("xi-api-key") ?? "")) {
      return Response.json(
        { detail: { status: "invalid_api_key", message: "Invalid API key" } },
        { status: 401 },
      );
    }
    if (this.failNext !== null && this.failNext.times > 0) {
      this.failNext.times--;
      return Response.json(
        { detail: { status: "error", message: "fail" } },
        { status: this.failNext.status },
      );
    }
    return this.route(call);
  };

  /** Kredit sarflaydigan (generatsiya) chaqiruvlar. */
  generationCalls(): FakeCall[] {
    return this.calls.filter(
      (c) =>
        c.method === "POST" &&
        !c.path.startsWith("/v1/pronunciation") &&
        c.path !== "/v1/music/plan",
    );
  }

  private audio(seconds: number): Response {
    return new Response(new Uint8Array(wav(seconds)), {
      status: 200,
      headers: { "content-type": "audio/wav", "request-id": `req_${this.calls.length}` },
    });
  }

  private route(call: FakeCall): Response {
    const { path } = call;
    const body = call.json ?? {};
    if (call.method === "GET" && path === "/v1/user/subscription")
      return Response.json(this.subscription);
    if (call.method === "GET" && path === "/v2/voices") {
      return Response.json({
        voices: [
          {
            voice_id: "voice_uz_1",
            name: "Aziz",
            category: "premade",
            labels: { language: "uz" },
            preview_url: null,
          },
          {
            voice_id: "voice_en_1",
            name: "Rachel",
            category: "premade",
            labels: { accent: "american" },
            preview_url: null,
          },
        ],
        has_more: false,
        next_page_token: null,
      });
    }
    if (call.method === "GET" && path === "/v1/models") {
      return Response.json([
        {
          model_id: "eleven_v4",
          name: "Eleven v4",
          can_do_text_to_speech: true,
          languages: [{ language_id: "uz", name: "Uzbek" }],
        },
        {
          model_id: "eleven_multilingual_v2",
          name: "Multilingual v2",
          can_do_text_to_speech: true,
          languages: [{ language_id: "en", name: "English" }],
        },
      ]);
    }
    let match = /^\/v1\/text-to-speech\/([^/]+)\/with-timestamps$/.exec(path);
    if (match !== null) {
      const text = String(body.text ?? "");
      const alignment = alignmentFor(text);
      const end = alignment.character_end_times_seconds.at(-1) ?? 0.5;
      return Response.json({
        audio_base64: wav(end + 0.2).toString("base64"),
        alignment,
        normalized_alignment: alignment,
      });
    }
    if (path === "/v1/text-to-dialogue") {
      const lines = (body.inputs as { text: string }[] | undefined) ?? [];
      return this.audio(lines.reduce((sum, line) => sum + line.text.length * 0.06 + 0.3, 0));
    }
    if (path === "/v1/sound-generation") return this.audio(Number(body.duration_seconds ?? 2));
    if (path === "/v1/music") {
      const plan = body.composition_plan as { sections?: { duration_ms: number }[] } | undefined;
      const ms =
        plan?.sections?.reduce((a, s) => a + s.duration_ms, 0) ??
        Number(body.music_length_ms ?? 10_000);
      return this.audio(ms / 1000);
    }
    if (path === "/v1/music/plan") {
      const ms = Number(body.music_length_ms ?? 10_000);
      return Response.json({
        positive_global_styles: ["upbeat"],
        negative_global_styles: [],
        sections: [
          {
            section_name: "intro",
            positive_local_styles: [],
            negative_local_styles: [],
            duration_ms: Math.round(ms / 2),
            lines: [],
          },
          {
            section_name: "main",
            positive_local_styles: [],
            negative_local_styles: [],
            duration_ms: ms - Math.round(ms / 2),
            lines: [],
          },
        ],
      });
    }
    if (path === "/v1/speech-to-text") {
      return Response.json({
        language_code: call.fields?.language_code ?? "uzb",
        language_probability: 0.93,
        text: this.sttText,
        words: words(this.sttText),
      });
    }
    if (path === "/v1/forced-alignment") {
      const text = call.fields?.text ?? "";
      return Response.json({
        characters: [...text].map((c, i) => ({ text: c, start: i * 0.06, end: i * 0.06 + 0.06 })),
        words: words(text).map(({ text: w, start, end }) => ({ text: w, start, end, loss: 0.1 })),
        loss: 0.1,
      });
    }
    if (path === "/v1/audio-isolation") return this.audio(2);
    match = /^\/v1\/speech-to-speech\/([^/]+)$/.exec(path);
    if (match !== null) return this.audio(2);
    if (call.method === "POST" && path === "/v1/dubbing") {
      const id = `dub_${this.calls.length}`;
      this.dubStatus.set(id, 0);
      return Response.json({ dubbing_id: id, expected_duration_sec: 5 });
    }
    match = /^\/v1\/dubbing\/([^/]+)$/.exec(path);
    if (match !== null && call.method === "GET") {
      const id = match[1]!;
      const polls = (this.dubStatus.get(id) ?? 0) + 1;
      this.dubStatus.set(id, polls);
      return Response.json({
        dubbing_id: id,
        name: "dub",
        status: polls >= this.dubbingPolls ? "dubbed" : "dubbing",
        target_languages: ["en"],
        error: null,
      });
    }
    match = /^\/v1\/dubbing\/([^/]+)\/audio\/([^/]+)$/.exec(path);
    if (match !== null) return this.audio(2);
    if (path === "/v1/text-to-voice/design") {
      return Response.json({
        previews: [
          {
            generated_voice_id: "gen_1",
            audio_base_64: wav(1).toString("base64"),
            media_type: "audio/wav",
            duration_secs: 1,
            language: "uz",
          },
          {
            generated_voice_id: "gen_2",
            audio_base_64: wav(1).toString("base64"),
            media_type: "audio/wav",
            duration_secs: 1,
            language: "uz",
          },
        ],
        text: "namuna matn",
      });
    }
    if (path === "/v1/text-to-voice")
      return Response.json({ voice_id: `designed_${String(body.generated_voice_id)}` });
    if (path === "/v1/voices/add")
      return Response.json({ voice_id: "cloned_1", requires_verification: false });
    if (path === "/v1/pronunciation-dictionaries/add-from-rules") {
      return Response.json({
        id: "dict_1",
        version_id: "ver_1",
        name: body.name,
        version_rules_num: (body.rules as unknown[]).length,
      });
    }
    return Response.json({ detail: { status: "not_found", message: path } }, { status: 404 });
  }
}
