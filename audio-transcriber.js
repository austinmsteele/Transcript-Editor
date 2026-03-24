const TARGET_SAMPLE_RATE = 16000;

export async function transcribeAudio(file, callbacks = {}) {
  callbacks.onStatus?.("Decoding audio...");
  const waveform = await decodeAudioFileToMono16k(file);

  callbacks.onStatus?.("Uploading audio...");
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Sample-Rate": String(TARGET_SAMPLE_RATE),
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: waveform.buffer,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Ignore invalid JSON payloads.
    }

    throw new Error(message);
  }

  return response.json();
}

async function decodeAudioFileToMono16k(file) {
  const buffer = await file.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    const mono = mixToMono(audioBuffer);
    return resampleChannel(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
  } finally {
    await audioContext.close();
  }
}

function mixToMono(audioBuffer) {
  const { numberOfChannels, length } = audioBuffer;
  const mono = new Float32Array(length);

  for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < length; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex] / numberOfChannels;
    }
  }

  return mono;
}

function resampleChannel(channel, inputRate, outputRate) {
  if (inputRate === outputRate) {
    return channel;
  }

  const sampleCount = Math.max(1, Math.round(channel.length * (outputRate / inputRate)));
  const result = new Float32Array(sampleCount);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < sampleCount; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, channel.length - 1);
    const weight = position - leftIndex;
    result[index] = channel[leftIndex] * (1 - weight) + channel[rightIndex] * weight;
  }

  return result;
}
