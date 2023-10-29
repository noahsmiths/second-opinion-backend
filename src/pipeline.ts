import 'dotenv/config';
import { Collection, Document, ObjectId } from 'mongodb';
import OpenAI from "openai";
import { transcribe } from './transcript';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY, // defaults to process.env["OPENAI_API_KEY"]
});

export function generateSummary(transcript: string) {
    return new Promise(async (res, rej) => {
        try {
            let summary = await openai.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {"role": "system", "content": "You are a healthcare assistant who's job it is to create a brief, couple sentence summary of the following transcript of an interaction between a doctor and a patient."},
                    {"role": "user", "content": `Transcript:\n\n${transcript}`},
                ]
            });

            res(summary.choices[0].message.content);
        } catch (err) {
            console.error(err);
            rej("Failed to generate summary. Check logs for more.");
        }
    });
}

interface Analysis {
    issuesFound: boolean,
    issueList: string,
    annotatedTranscription: string
}

export function analyzeData(transcript: string, notes: string) {
    return new Promise<Analysis>(async (res, rej) => {
        let textResponse = "";
        let issueFound = false;

        try {
            let summary = await openai.chat.completions.create({
                model: "gpt-4",
                temperature: 0,
                messages: [
                    {"role": "system", "content": "You're a healthcare assistant who's job it is to review a doctor's notes and a transcript of a conversation between that doctor and a patient. Review the doctor's recommendations for any potential issues, misunderstandings, or incongruities between what the patient said and what the doctor noted. If there are any, create a brief list of them in JSON as an array of objects. These object should have a key 'issue' mapping to a string and a key 'description' mapping to a string. If there are none, return an empty JSON array."},
                    {"role": "user", "content": `Doctor's Notes:\n\n${notes}\n\nTranscript:\n\n${transcript}`},
                ]
            });

            textResponse = summary.choices[0].message.content || '';

            // if (JSON.parse(textResponse)?.length === 0) {
            //     res({
            //         issuesFound: false,
            //         issueList: "None",
            //         annotatedTranscription: "No issues detected"
            //     });
            //     return;
            // }

            issueFound = JSON.parse(textResponse)?.length !== 0;
        } catch (err) {
            console.error(err);
            rej(err);
            return;
        }

        try {
            let flaggedTranscription = await openai.chat.completions.create({
                model: "gpt-4",
                temperature: 0,
                messages: [
                    {"role": "system", "content": "You're a healthcare assistant who's job it is to review a doctor's notes and a transcript of a conversation between that doctor and a patient. Review the doctor's recommendations for any potential issues, misunderstandings, or incongruities between what the patient said and what the doctor noted. If there are any, create a brief list of them in JSON as an array of objects. These object should have a key 'issue' mapping to a string and a key 'description' mapping to a string. If there are none, return an empty JSON array."},
                    {"role": "user", "content": `Doctor's Notes:\n\n${notes}\n\nTranscript:\n\n${transcript}`},
                    {"role": "assistant", "content": textResponse},
                    {"role": "user", "content": `Reprint the entire transcript but replace the labels with Doctor or Patient. Also, if you identified any potential issues, highlight the area in the transcript where each issue was found by surrounding the specific words with the following characters: ##. Be as precise as possible, and make sure to reproduce the entire transcript with the only the changes described.`}
                ]
            });

            res({
                issuesFound: issueFound,
                issueList: textResponse,
                annotatedTranscription: flaggedTranscription.choices[0].message.content || ''
            });
            return;
        } catch (err) {
            console.error(err);
            rej(err);
            return;
        }
    });
}

interface PipelineParams {
    sessionCollection: Collection<Document>,
    sessionId: string,
    patientId: string,
    filePath: string,
    notes: string
}

export async function triggerPipeline({ sessionCollection, sessionId, patientId, filePath, notes }: PipelineParams) {
    // Get data from mongo, fire off GPT if transcription and Doctor's Notes exist
    // let notes = "some notes here";
    // let transcript = "some transcript here";
    let formattedTranscription = "";

    try {
        console.log("Transcribing");
        let transcription = await transcribe(filePath);

        for (let utterance of transcription.utterances) {
            formattedTranscription += `Speaker ${utterance.speaker}: ${utterance.text}\n\n`;
        }
        console.log("Transcription complete");
    } catch (err) {
        console.error(err);
        await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
            $set: {
                transcript: "Transcription failed. Check logs for details."
            }
        });
        return;
    }

    if (formattedTranscription.trim() === '') {
        await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
            $set: {
                transcript: "No transcription found."
            }
        });
        return;
    }

    await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
        $set: {
            transcript: formattedTranscription
        }
    });

    try {
        console.log("Analyzing with GPT");
        let [summary, analysis] = await Promise.all([generateSummary(formattedTranscription), analyzeData(notes, formattedTranscription)]);

        await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
            $set: {
                summary: summary
            }
        });

        console.log("Summary updated");

        if (analysis.issuesFound) {
            console.log("Issues found during analysis");
            try {
                let parsedIssues = JSON.parse(analysis.issueList);

                await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
                    $set: {
                        flags: parsedIssues,
                        annotated_transcript: analysis.annotatedTranscription
                    }
                });
            } catch (err) {
                console.error(err);
                console.error(analysis.issueList);

                await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
                    $set: {
                        flags: [{issue: `Issue parsing annotations.`, description: `Raw GPT results: ${analysis.issueList}`}],
                        annotated_transcript: analysis.annotatedTranscription
                    }
                });
            }
        } else {
            console.log("No issues found during analysis");
            await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
                $set: {
                    annotated_transcript: analysis.annotatedTranscription
                }
            });
        }

        return;
    } catch (err) {
        console.error(err);
        await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
            $set: {
                summary: "GPT Interaction Failed. Check logs.",
                annotated_transcript: "GPT Interaction Failed. Check logs.",
            }
        });
        return;
    }

}