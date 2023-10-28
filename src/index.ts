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

const upload = multer({ dest: './uploads' });

app.post("/upload_transcript", upload.single('transcript'), (req: Request, res: Response) => {
    let filePath = req.file?.path || '';
    let newFilePath = filePath + ".webm";
    fs.renameSync(filePath, newFilePath);
    console.log(newFilePath);
    transcribe(newFilePath);
    res.send({ status: "complete" });
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});