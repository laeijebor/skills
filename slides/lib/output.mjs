import { mkdir, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
export async function assertOutputPath(command, input, out) {
  let info;
  try { info = await stat(out); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const directoryOutput = command === 'check' || command === 'png';
  if (info.isDirectory()) {
    if (!directoryOutput) throw new Error(`Output is a directory: ${out}`);
    return;
  }
  if (directoryOutput) throw new Error(`Output must be a directory: ${out}`);
  const target = await realpath(out), source = await realpath(input);
  if (target === source) throw new Error('Output must differ from the source deck');
  const deckDirectory = path.dirname(input), root = await realpath(deckDirectory);
  if ((inside(deckDirectory, out) || inside(root, target)) && [out, target].some(file => path.extname(file).toLowerCase() !== `.${command}`)) {
    throw new Error(`Refusing to overwrite an existing non-${command} file in the deck folder: ${out}`);
  }
}
export async function preparePngDirectory(out) {
  await mkdir(out, { recursive: true });
  for (const entry of await readdir(out, { withFileTypes: true })) {
    if (/^\d{2}-.*\.png$/.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())) await unlink(path.join(out, entry.name));
  }
}
export async function writePresentation(pptx, out) {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await pptx.write({ outputType: 'nodebuffer' }));
}
