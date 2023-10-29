import express, { Request, Response } from "express";
import multer from "multer";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { transcribe } from "./transcript";

const PORT = 8080;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, './uploads')
    },
    filename: function (req, file, cb) {
        cb(null, 'transcription.webm')
    }
});

const upload = multer({ storage: storage });

app.post("/upload_transcript", upload.single('transcript'), (req: Request, res: Response) => {
    // let filePath = req.file?.path || '';
    // let newFilePath = filePath + ".webm";
    // fs.renameSync(filePath, newFilePath);
    // console.log(newFilePath);
    console.log(req.file?.path);
    let filePath = process.env.PRODUCTION ? "/app/uploads/transcription.webm" : (req.file?.path || '');
    console.log(filePath);
    transcribe(filePath);
    res.send({ status: "complete" });
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});