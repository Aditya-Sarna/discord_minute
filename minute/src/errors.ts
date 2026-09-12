export function stakeholderError(message: string): string {
  const one = message.replace(/\s+/g, " ").trim();
  if (/403/.test(one) && /repositor/i.test(one)) {
    return "GitHub wouldn’t create a new repo for Minute. The token needs permission to create repositories under the playground owner.";
  }
  if (/403|Permission to .+ denied/i.test(one)) {
    return "GitHub refused the push. The token can log in but can’t write a branch on this repo. Give the PAT access to the playground repo with Contents: Read and write, and Pull requests: Read and write.";
  }
  if (/GitHub repo not found/i.test(one)) {
    return "I can’t see that GitHub repo. It may be private, or the link is wrong.";
  }
  if (/name already exists|Validation Failed|Could not create a GitHub repo/i.test(one)) {
    return "Couldn’t create a GitHub repo with that name. Try a shorter name, or ping tech.";
  }
  if (/Resource not accessible by integration|must be an organization|Repository creation failed/i.test(one)) {
    return "GitHub wouldn’t create a new repo for Minute. The token needs permission to create repositories under the playground owner.";
  }
  if (/preview process exited/i.test(one)) {
    return "Couldn’t boot the app for a photo — the start command crashed. The change may still be in the PR.";
  }
  if (/Playwright|Executable doesn't exist/i.test(one)) {
    return "Couldn’t take a photo — Playwright Chromium isn’t installed.";
  }
  if (/BASE_TYPE_MAX_LENGTH|2000 or fewer/i.test(one)) {
    return "Discord wouldn’t post the update — the message was too long. Try the request again.";
  }
  if (/npm install failed|ERESOLVE|legacy-peer-deps/i.test(one)) {
    return "Couldn’t boot the app for a photo (npm install). The change may still be in the PR.";
  }
  return one.replace(/https:\/\/[^/\s]*:[^/\s]*@/g, "https://***@").slice(0, 280);
}
