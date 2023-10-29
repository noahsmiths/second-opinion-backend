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
                    {"role": "user", "content": `Reprint the entire transcript. If you identified any potential issues, highlight the words in the transcript where the issue was found by surrounding them with a 'b' html tag. Be precise, and try to wrap only the necessary words.`}
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

export function segmentTranscript(rawTranscript: string) {
    return new Promise<string>(async (res, rej) => {
        try {
            let segmentedTranscript = await openai.chat.completions.create({
                model: "gpt-4",
                temperature: 0,
                messages: [
                    {"role": "system", "content": "You are a healthcare assistant. Your job is to take a raw transcription of a conversation between a doctor and a patient, and return that exact transcript with labels of which speaker it is."},
                    {"role": "user", "content": `Transcript:\n\n${rawTranscript.replace(/\n\n/g, "\n")}`},
                ]
            });

            res(segmentedTranscript.choices[0].message.content || '');
        } catch (err) {
            console.error(err);
            rej(err);
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
    let transcription;

    try {
        console.log("Transcribing");
        transcription = await transcribe(filePath);
        formattedTranscription = transcription.text;

        // for (let utterance of transcription.utterances) {
        //     formattedTranscription += `Speaker ${utterance.speaker}: ${utterance.text}\n\n`;
        // }
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

    let segmented = "";

    try {
        console.log("segmenting");

        segmented = await segmentTranscript(transcription.text);
        await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
            $set: {
                annotated_transcript: segmented
            }
        });

        console.log("segmentation complete");
    } catch (err) {
        console.error(err);
        await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
            $set: {
                annotated_transcript: "Segmentation failed. Check logs for details."
            }
        });
        return;
    }

    try {
        console.log("Analyzing with GPT");
        let [summary, analysis] = await Promise.all([generateSummary(segmented), analyzeData(segmented, notes)]);

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
                        annotated_transcript: analysis.annotatedTranscription.split('<b>').join('<span style="color: red; text-decoration: underline; font-weight: bold">').split('</b>').join('</span>')
                    }
                });
            } catch (err) {
                console.error(err);
                console.error(analysis.issueList);

                await sessionCollection.findOneAndUpdate({ "_id": new ObjectId(sessionId)}, {
                    $set: {
                        flags: [{issue: `Issue parsing annotations.`, description: `Raw GPT results: ${analysis.issueList}`}],
                        annotated_transcript: analysis.annotatedTranscription.split('<b>').join('<span style="color: red; text-decoration: underline; font-weight: bold">').split('</b>').join('</span>')
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
                // annotated_transcript: "GPT Interaction Failed. Check logs.",
            }
        });
        return;
    }

}