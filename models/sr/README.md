# Sentinel-2 super-resolution models

ONNX models from [openearthplatforminitiative/sentinel2-super-resolution](https://github.com/openearthplatforminitiative/sentinel2-super-resolution),
originally from [Evoland sentinel2_superresolution](https://github.com/Evoland-Land-Monitoring-Evolution/sentinel2_superresolution). Apache License 2.0 (see LICENSE).

| File | Input | Output | Trained on |
|---|---|---|---|
| `s2v2x2_spatrad.onnx` | B02 B03 B04 B08 at 10 m, reflectance x 10000 | same bands at 5 m | Sen2Venus |
| `wsx4_spatrad.onnx` | B02 B03 B04 B08 at 10 m, reflectance x 10000 | same bands at 2.5 m | WorldStrat |

Run in the browser by `js/superres.js` with onnxruntime-web. Model output is an estimate, not a measurement.
