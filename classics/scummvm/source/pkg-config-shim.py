#!/usr/bin/env python3
"""A very small pkg-config, for build machines without one.

ScummVM's configure asks `pkg-config sdl3 --modversion|--cflags|--libs|--static-libs`
under Emscripten, and that is all this answers. It reads the real .pc file that
`embuilder build sdl3` installs, from PKG_CONFIG_LIBDIR, so nothing is invented.
"""
import os
import re
import sys


def main(argv):
    wanted = [a for a in argv if not a.startswith('-')]
    opts = [a for a in argv if a.startswith('-')]
    for name in wanted:
        pc = None
        for d in os.environ.get('PKG_CONFIG_LIBDIR', '').split(':'):
            p = os.path.join(d, name + '.pc')
            if d and os.path.exists(p):
                pc = p
                break
        if pc is None:
            return 1
        variables, fields = {}, {}
        for line in open(pc, encoding='utf8'):
            line = line.strip()
            m = re.match(r'^([A-Za-z_.]+)=(.*)$', line)
            if m:
                variables[m.group(1)] = m.group(2)
                continue
            m = re.match(r'^([A-Za-z.]+):\s*(.*)$', line)
            if m:
                fields[m.group(1)] = m.group(2)

        def expand(s):
            for _ in range(5):
                s = re.sub(r'\$\{([^}]+)\}', lambda x: variables.get(x.group(1), ''), s)
            return s

        out = []
        for o in opts:
            if o == '--modversion':
                out.append(fields.get('Version', ''))
            elif o == '--cflags':
                out.append(expand(fields.get('Cflags', '')))
            elif o == '--libs':
                out.append(expand(fields.get('Libs', '')))
            elif o == '--static-libs' or o == '--static':
                out.append(expand(fields.get('Libs', '')) + ' ' + expand(fields.get('Libs.private', '')))
            elif o == '--exists':
                pass
        if out:
            print(' '.join(out).strip())
    return 0 if wanted else 1


sys.exit(main(sys.argv[1:]))
