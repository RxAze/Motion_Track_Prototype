import traceback
print("Step 1: imports")
import tensorflow as tf
import tensorflowjs as tfjs
print("Step 2: load model")
m = tf.keras.models.load_model("ml/exports/gesture_model.keras")
print("Step 3: export tfjs")
tfjs.converters.save_keras_model(m, "public/models/gesture_model")
print("SUCCESS: exported")
