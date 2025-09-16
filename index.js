import { getInput, getMultilineInput, setFailed, summary } from "@actions/core";
import { get } from "https";
import { createWriteStream } from "fs";
import { mkdir, readdir, stat } from "fs/promises";
import { dirname, join } from "path";

async function run() {
  try {
    const pat = getInput("git-pat");
    const repo = getInput("repo", { required: true });
    const ref = getInput("ref", { required: true });
    const outputDir = getInput("output-directory", { required: true });
    const includes = getMultilineInput("includes");

    if (!includes.length) {
      throw new Error("No files specified in 'includes'.");
    }

    const options = pat ? { headers: { Authorization: `token ${pat}` } } : {};

    const downloads = includes.map(async (include) => {
      const [input, output] = include.split(":");
      const outputLocation = join(outputDir, output);
      const url = `https://raw.githubusercontent.com/${repo}/${ref}/${input}`;

      await mkdir(dirname(outputLocation), { recursive: true });
      await download(url, options, outputLocation);

      console.log(`✅ Downloaded "${input}" → "${outputLocation}"`);
      return outputLocation;
    });

    const downloadedFiles = await Promise.all(downloads);

    const allFiles = await getFiles(outputDir);

    await summary
      .addHeading("Download Summary")
      .addTable([
        [
          { data: "Description", header: true },
          { data: "Result", header: true },
        ],
        ["Repo", repo],
        ["Ref", ref],
        ["Downloaded Files", downloadedFiles.join("\n")],
        ["All Files in Output", allFiles.join("\n")],
      ])
      .write();
  } catch (error) {
    setFailed(error instanceof Error ? error.message : String(error));
  }
}

async function download(url, options, output) {
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(output);

    const req = get(url, options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(
          new Error(`Failed to download ${url} (status ${res.statusCode})`)
        );
        res.resume();
        return;
      }

      res.pipe(fileStream);

      fileStream.on("finish", () => fileStream.close(resolve));
    });

    req.on("error", (err) => reject(err));

    req.setTimeout(15000, () => {
      req.destroy(new Error(`Request timed out for ${url}`));
    });
  });
}

async function getFiles(directory) {
  const files = await readdir(directory, { recursive: true });
  const filePaths = [];

  for (const file of files) {
    const fullPath = join(directory, file);
    const stats = await stat(fullPath);
    if (stats.isFile()) {
      filePaths.push(fullPath);
    }
  }

  return filePaths;
}

run();
