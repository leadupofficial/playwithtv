"""
Shrinks equirectangular HDRIs for runtime image-based light (a 512×256 Radiance .hdr is ~300 KB, plenty for PMREM
lighting and a softly blurred sky):

  blender -b --factory-startup -P tools/blender/kalari/shrink_hdri.py -- <in.hdr> <out.hdr> [width]
"""
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
src, dst = args[0], args[1]
w = int(args[2]) if len(args) > 2 else 512
img = bpy.data.images.load(src)
img.scale(w, w // 2)
img.filepath_raw = dst
img.file_format = "HDR"
img.save()
print("[pwtv] wrote", dst, img.size[:])
