let githubToken: string | null = null;

export function getGithubToken(): string | null {
  return githubToken;
}

export function setGithubToken(token: string): void {
  githubToken = token;
}
