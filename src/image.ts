import { Ai } from "@cloudflare/ai";

export async function generateImage(ai: Ai, prompt: string) {
  return await ai.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", { prompt });
}.
