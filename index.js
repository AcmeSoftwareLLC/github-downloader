import { getInput, getMultilineInput, setFailed, summary } from "@actions/core";
import { get } from "https";
import { createWriteStream } from "fs";
import { mkdir, readdir, stat } from "fs/promises";
import { dirname, join } from "path";

async function run() {
  try {
    const pat = getInput("git-pat");
    const repo = getInput("repo", { required: true });
    const ref = getInput("ref") || "main";
    const outputDir = getInput("output-directory");
    const includes = getMultilineInput("includes");

    if (!includes.length) {
      throw new Error("No files specified in 'includes'.");
    }

    const options = pat ? { headers: { Authorization: `token ${pat}` } } : {};

    const downloads = includes.map(async (include) => {
      const [input, output] = include.split(":");
      if (!output) {
        throw new Error(
          `Invalid 'includes' format: "${include}". Expected format is "source:destination".`
        );
      }
      const outputLocation = outputDir ? join(outputDir, output) : output;
      const url = `https://raw.githubusercontent.com/${repo}/${ref}/${input}`;

      await mkdir(dirname(outputLocation), { recursive: true });
      await download(url, options, outputLocation);

      console.log(`✅ Downloaded "${input}" → "${outputLocation}"`);
      return outputLocation;
    });

    const downloadedFiles = await Promise.all(downloads);

    const allFiles = outputDir ? await getFiles(outputDir) : downloadedFiles;

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
        ...(outputDir ? [["All Files in Output", allFiles.join("\n")]] : []),
      ])
      .write();
  } catch (error) {
    setFailed(error instanceof Error ? error.message : String(error));
  }
}

async function download(url, options, output) {
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(output);
    fileStream.on("error", reject);

    const req = get(url, options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(
          new Error(`Failed to download ${url} (status ${res.statusCode})`)
        );
      }

      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close((err) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });
    });

    req.on("error", reject);

    req.setTimeout(15000, () => {
      req.destroy(new Error(`Request timed out for ${url}`));
    });
  });
}

async function getFiles(directory) {
  const dirents = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) => join(directory, dirent.name));
}

run();
