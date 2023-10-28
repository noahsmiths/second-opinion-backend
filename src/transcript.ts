import 'dotenv/config';
import { AssemblyAI } from 'assemblyai';
import fs from 'node:fs';

export function transcribe(filePath: string) {
    console.log("transcribing");

    const client = new AssemblyAI({
        apiKey: process.env.ASSEMBLYAI_KEY,
    });

    const data = {
        audio_url: filePath,
        speaker_labels: true,
        speakers_expected: 2
    };

    const run = async () => {
        const transcript = await client.transcripts.create(data);
        // console.log(transcript.text);

        for (let utterance of transcript.utterances) {
            console.log(`Speaker ${utterance.speaker}: ${utterance.text}`);
        }

        // fs.rmSync(filePath);
    };

    run();
}