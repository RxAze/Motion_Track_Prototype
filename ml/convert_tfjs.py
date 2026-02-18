import os, time
import tensorflow as tf
import tensorflowjs as tfjs

src = "/tmp/gesture_model.keras"

dst = "public/models/gesture_model"

print("Exists:", os.path.exists(src), flush=True)
print("Size bytes:", os.path.getsize(src), flush=True)
t0 = time.time()
print("Loading Keras model (compile=False)...", flush=True)
model = tf.keras.models.load_model(src, compile=False)
print(f"Loaded in {time.time()-t0:.2f}s", flush=True)

t1 = time.time()
print("Exporting TFJS model...", flush=True)
tfjs.converters.save_keras_model(model, dst)
print(f"Exported in {time.time()-t1:.2f}s", flush=True)
print("Done:", dst, flush=True)
