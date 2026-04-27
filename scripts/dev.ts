const reclaimPort = async (port: number): Promise<void> => {
  Bun.spawnSync({
    cmd: ['fuser', '-k', '-9', `${port}/tcp`],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
};

const main = async (): Promise<void> => {
  const build = Bun.spawn({
    cmd: ['bun', 'run', 'build'],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });
  const code = await build.exited;
  if (code !== 0) {
    process.exit(code);
  }

  await reclaimPort(8787);

  const watcher = Bun.spawn({
    cmd: ['bunx', 'vite', 'build', '--watch', '--emptyOutDir', 'false'],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const wrangler = Bun.spawn({
    cmd: ['bunx', 'wrangler', 'dev', '--port', '8787'],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const stop = () => {
    if (!watcher.killed) watcher.kill();
    if (!wrangler.killed) wrangler.kill();
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

void main();
