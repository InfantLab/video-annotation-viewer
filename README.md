# Video Annotation Viewer has moved

**The viewer now lives in [InfantLab/VideoAnnotator](https://github.com/InfantLab/VideoAnnotator), in the [`viewer/`](https://github.com/InfantLab/VideoAnnotator/tree/master/viewer) folder.** This repository is archived and read-only.

- **Use it with VideoAnnotator**: the viewer is bundled with the server at `http://127.0.0.1:18011/viewer`. Nothing to install separately.
- **Run it standalone** (to review output from other tools):
  ```bash
  git clone https://github.com/InfantLab/VideoAnnotator.git
  cd VideoAnnotator/viewer
  bun install
  bun run dev
  ```
- **Issues and contributions**: [InfantLab/VideoAnnotator issues](https://github.com/InfantLab/VideoAnnotator/issues).

Its full history, including the `v0.x.x` releases (tagged `viewer-v0.x.x` there), was merged into VideoAnnotator for v1.5.0. From VideoAnnotator v1.6.0 the viewer shares VideoAnnotator's version number and changelog. The last standalone release here is v0.7.0.
