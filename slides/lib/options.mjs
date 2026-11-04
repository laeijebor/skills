import path from 'node:path';
import { THEME } from './deck.mjs';
const commands = ['new', 'check', 'png', 'pdf', 'pptx', 'html'];
const values = new Set(['title', 'theme', 'out', 'browser', 'scale', 'slide']);
const flags = new Set(['help', 'json', 'onepager', 'force']);
export function parseOptions(args) {
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h') { options.help = true; continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [key, ...rest] = arg.slice(2).split('=');
    if (flags.has(key)) {
      if (rest.length) throw new Error(`--${key} does not take a value`);
      options[key] = true;
    } else if (values.has(key)) {
      const value = rest.length ? rest.join('=') : args[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${key} needs a value`);
      options[key] = value;
    } else throw new Error(`Unknown option: --${key}`);
  }
  const [command, input, ...extra] = positional;
  if (command && !commands.includes(command)) throw new Error(`Unknown command: ${command}`);
  if (extra.length) throw new Error('Expected one input path');
  if (!options.help && command && !input) throw new Error(`${command} needs a ${command === 'new' ? 'directory' : 'deck.html path'}`);
  const allowed = new Set(['help', 'json', ...(command === 'new' ? ['title', 'theme', 'onepager', 'force'] : ['theme', 'out', 'browser', ...(command === 'png' ? ['scale', 'slide'] : [])])]);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`--${key} is not supported by ${command}`);
  if (options.theme && !(command === 'new' ? ['ink', 'paper'].includes(options.theme) : THEME.test(options.theme))) throw new Error('Invalid theme name');
  if (options.scale !== undefined && (!Number.isFinite(Number(options.scale)) || Number(options.scale) <= 0 || Number(options.scale) > 8)) throw new Error('--scale must be greater than 0 and at most 8');
  return { command, input, options };
}
export function outputPath(command, input, out) {
  if (out) return path.resolve(out);
  const absolute = path.resolve(input), dir = path.dirname(absolute), name = path.basename(absolute, path.extname(absolute));
  if (command === 'png') return path.join(dir, 'png');
  if (command === 'check') return path.join(dir, '.slides', 'check');
  return path.join(dir, `${name}.${command === 'html' ? 'bundle.html' : command}`);
}
