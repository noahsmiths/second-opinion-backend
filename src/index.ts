import express, { Request, Response } from "express";
import multer from "multer";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { transcribe } from "./transcript";
import { analyzeData, triggerPipeline } from "./pipeline";
import { MongoClient, ServerApiVersion } from "mongodb";

const PORT = 8080;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const client = new MongoClient(process.env.MONGO_URL || '', {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
const db = client.db('development');
const patientSessions = db.collection('sessions');

const upload = multer({ dest: './uploads' });

app.post("/create_session", upload.single('transcript'), async (req: Request, res: Response) => {
    try {
        if (!req.body.patientId || !req.body.notes || !req.file?.path) {
            console.error("Bad parameters received");
            res.status(400).send({ error: "Malformed parameters" });
            return;
        }
        let filePath = req.file?.path || '';
        let newFilePath = filePath + ".webm";
        fs.renameSync(filePath, newFilePath);
        console.log(newFilePath);
        // triggerPipeline("some-id-here");
        // triggerTranscription("some-id-here-from-request", newFilePath);
        let { insertedId } = await patientSessions.insertOne({
            patientId: req.body.patientId,
            notes: req.body.notes,
            summary: null,
            transcript: null,
            annotated_transcript: null,
            flags: [],
            timestamp: Date.now()
        });

        console.log(req.body.patientId);
        console.log(req.body.notes);
        res.send({ status: "received" });

        triggerPipeline({
            sessionCollection: patientSessions,
            sessionId: insertedId.toString(),
            patientId: req.body.patientId,
            filePath: newFilePath,
            notes: req.body.notes
        });
    } catch (err: any) {
        res.status(503).send({ error: err.toString() });
    }
});

// function triggerTranscription(id: string, filePath: string) {
//     let transcription;

//     try {
//         transcription = transcribe(filePath);
//     } catch (err) {
//         console.error(err);
//     }

//     // Save data to mongo here
//     triggerPipeline(id);
// }

// analyzeData(`SPEAKER A: Yeah. How are you doing today?

// SPEAKER B: I've been having a bit of trouble breathing lately, doctor.

// SPEAKER A: Have you had any type of cold lately?

// SPEAKER B: No, no cold. I just have a heavy feeling in my chest when I try to breathe.

// SPEAKER A: Do you have any allergies that you know of?

// SPEAKER B: No, I don't have any that I know of.

// SPEAKER A: Does this happen all the time or mostly when you are active?

// SPEAKER B: It happens a lot, especially when I work out.

// SPEAKER A: Okay, well, I'm going send you to a pulmonary specialist who can run tests on you for asthma.

// SPEAKER B: Okay. Thanks for your help, doctor.`, `Patient came in noting trouble breathing. No signs of cold or alergies. Happens only when active - reffered to specialist for bronchitis.`)
// .then((res) => {console.log(res)}).catch(console.error);

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});