/**
 * P4.02: ElevenLabs imkoniyatlari — yo'llar, maydonlar va javob shakllari rasmiy API reference bo'yicha (soxta API).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { forcedAlignment, isolate, speechToText } from "../src/eleven/analyze";
import { sniffAudio } from "../src/eleven/audio";
import { ElevenClient } from "../src/eleven/client";
import { dialogue, music, musicPlan, soundEffect } from "../src/eleven/generate";
import { tts } from "../src/eleven/tts";
import {
  cloneVoice,
  createDesignedVoice,
  createDictionary,
  designVoice,
  dub,
  listModels,
  listVoices,
  voiceChange,
} from "../src/eleven/voice";
import { FakeEleven, VALID_KEY, wav } from "./helpers/fake-eleven";

let el: FakeEleven;
let client: ElevenClient;
const file = { data: wav(1), filename: "a.wav", contentType: "audio/wav" };

beforeEach(() => {
  el = new FakeEleven();
  client = new ElevenClient(VALID_KEY, { fetch: el.fetch, sleep: async () => {} });
});

const last = () => el.calls.at(-1)!;

describe("ElevenLabs imkoniyatlari", () => {
  it("TTS with-timestamps: audio + alignment", async () => {
    const res = await tts(client, {
      voice_id: "voice_uz_1",
      text: "Salom. Dunyo!",
      model_id: "eleven_v4",
      language_code: "uz",
    });
    expect(last()).toMatchObject({
      path: "/v1/text-to-speech/voice_uz_1/with-timestamps",
      query: { output_format: "mp3_44100_128" },
      json: { text: "Salom. Dunyo!", model_id: "eleven_v4", language_code: "uz" },
    });
    expect(res.ext).toBe("wav");
    const alignment = res.data!.alignment as { characters: string[] };
    expect(alignment.characters.join("")).toBe("Salom. Dunyo!");
  });

  it("dialogue, SFX, music (+plan)", async () => {
    await dialogue(client, {
      inputs: [
        { text: "Salom", voice_id: "a" },
        { text: "Va alaykum", voice_id: "b" },
      ],
    });
    expect(last()).toMatchObject({ path: "/v1/text-to-dialogue", json: { model_id: "eleven_v3" } });
    const sfx = await soundEffect(client, { text: "whoosh", duration_seconds: 0.8 });
    expect(last()).toMatchObject({
      path: "/v1/sound-generation",
      json: { text: "whoosh", duration_seconds: 0.8, model_id: "eleven_text_to_sound_v2" },
    });
    expect(sfx.audio.length).toBeGreaterThan(44);
    await music(client, { prompt: "upbeat", music_length_ms: 12_000, force_instrumental: true });
    expect(last()).toMatchObject({
      path: "/v1/music",
      json: { prompt: "upbeat", music_length_ms: 12_000, force_instrumental: true },
    });
    const plan = await musicPlan(client, { prompt: "calm", music_length_ms: 20_000 });
    expect(plan.sections.reduce((a, s) => a + s.duration_ms, 0)).toBe(20_000);
    await music(client, { composition_plan: plan });
    expect(last().json).toHaveProperty("composition_plan");
  });

  it("STT, forced alignment, isolation — multipart", async () => {
    const transcript = await speechToText(client, { file, language_code: "uzb", diarize: true });
    expect(last()).toMatchObject({
      path: "/v1/speech-to-text",
      fields: {
        model_id: "scribe_v2",
        language_code: "uzb",
        diarize: "true",
        timestamps_granularity: "word",
      },
      files: ["file"],
    });
    expect(transcript.words[0]).toMatchObject({ text: "Salom", start: 0, end: 0.4 });
    const aligned = await forcedAlignment(client, { file, text: "Bir ikki uch" });
    expect(last()).toMatchObject({
      path: "/v1/forced-alignment",
      fields: { text: "Bir ikki uch" },
      files: ["file"],
    });
    expect(aligned.words.map((w) => w.text)).toEqual(["Bir", "ikki", "uch"]);
    const clean = await isolate(client, { file });
    expect(last()).toMatchObject({ path: "/v1/audio-isolation", files: ["audio"] });
    expect(clean.ext).toBe("wav");
  });

  it("voice changer, voice design + create, clone, voices/models, pronunciation", async () => {
    await voiceChange(client, { voice_id: "v1", file });
    expect(last()).toMatchObject({
      path: "/v1/speech-to-speech/v1",
      fields: { model_id: "eleven_multilingual_sts_v2" },
      files: ["audio"],
    });
    const design = await designVoice(client, { voice_description: "Yosh, iliq erkak ovozi" });
    expect(last().json).toMatchObject({
      auto_generate_text: true,
      model_id: "eleven_multilingual_ttv_v2",
    });
    expect(design.previews).toHaveLength(2);
    const created = await createDesignedVoice(client, {
      voice_name: "Aziz",
      voice_description: "x",
      generated_voice_id: design.previews[0]!.generated_voice_id,
    });
    expect(created.voice_id).toBe("designed_gen_1");
    const clone = await cloneVoice(client, { name: "Mijoz", files: [file, file] });
    expect(last()).toMatchObject({
      path: "/v1/voices/add",
      fields: { name: "Mijoz" },
      files: ["files", "files"],
    });
    expect(clone.voice_id).toBe("cloned_1");
    expect((await listVoices(client, { search: "Aziz" })).map((v) => v.voice_id)).toContain(
      "voice_uz_1",
    );
    expect(last().query).toMatchObject({ search: "Aziz", page_size: "100" });
    const models = await listModels(client);
    expect(models.find((m) => m.model_id === "eleven_v4")?.languages).toEqual([
      { language_id: "uz", name: "Uzbek" },
    ]);
    const dict = await createDictionary(client, {
      name: "brand-uz",
      rules: [{ type: "alias", string_to_replace: "AE", alias: "ey-i" }],
    });
    expect(dict).toMatchObject({ id: "dict_1", version_id: "ver_1" });
  });

  it("dubbing: yaratish → status poll → audio; failed va timeout", async () => {
    el.dubbingPolls = 3;
    const sleeps: number[] = [];
    const res = await dub(
      client,
      { file, target_lang: "en" },
      { sleep: async (ms) => void sleeps.push(ms), pollMs: 5 },
    );
    expect(sleeps).toEqual([5, 5]);
    expect(res.data).toMatchObject({ dubbing_id: expect.stringMatching(/^dub_/) });
    expect(last().path).toMatch(/^\/v1\/dubbing\/dub_\d+\/audio\/en$/);

    el.dubbingPolls = 1_000;
    let clock = 0;
    await expect(
      dub(
        client,
        { file, target_lang: "en" },
        { sleep: async () => void (clock += 60_000), now: () => clock, timeoutMs: 120_000 },
      ),
    ).rejects.toMatchObject({ error: { code: "EL_TIMEOUT" } });
  });

  it("sniffAudio", () => {
    expect(sniffAudio(wav(0.1)).ext).toBe("wav");
    expect(sniffAudio(Buffer.from("ID3\x03abc", "latin1")).ext).toBe("mp3");
    expect(sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00])).ext).toBe("mp3");
    expect(sniffAudio(Buffer.from("OggS....", "latin1")).ext).toBe("ogg");
    expect(sniffAudio(Buffer.from("....ftypM4A ", "latin1")).ext).toBe("m4a");
  });
});
