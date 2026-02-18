import argparse
import json
import time
from pathlib import Path

import numpy as np
import tensorflow as tf

LABEL_TO_INDEX = {"neutral": 0, "open_palm": 1, "pinch": 2}


def log(message: str):
  print(f"[train.py] {time.strftime('%H:%M:%S')} | {message}", flush=True)


def load_jsonl_dataset(path: Path, sequence_length: int):
  sequences = []
  labels = []
  skipped_malformed = 0
  with path.open("r", encoding="utf-8-sig") as handle:
    for line_number, line in enumerate(handle, start=1):
      line = line.strip().lstrip("\ufeff")
      if not line:
        continue
      try:
        record = json.loads(line)
      except json.JSONDecodeError:
        skipped_malformed += 1
        continue
      label = record["label"]
      sequence = record["sequence"]
      if label not in LABEL_TO_INDEX:
        continue
      if len(sequence) != sequence_length:
        continue
      sequences.append(sequence)
      labels.append(LABEL_TO_INDEX[label])

  if not sequences:
    raise ValueError("Dataset is empty or no rows match the expected shape.")

  x = np.asarray(sequences, dtype=np.float32)
  y = tf.keras.utils.to_categorical(np.asarray(labels), num_classes=3)
  class_counts = {name: labels.count(index) for name, index in LABEL_TO_INDEX.items()}
  log(
    f"Dataset loaded: samples={len(sequences)}, feature_shape={x.shape}, "
    f"class_counts={class_counts}, skipped_malformed={skipped_malformed}"
  )
  return x, y


def build_model(sequence_length: int, feature_dim: int):
  inputs = tf.keras.Input(shape=(sequence_length, feature_dim))
  x = tf.keras.layers.Conv1D(32, 3, padding="same", activation="relu")(inputs)
  x = tf.keras.layers.Conv1D(64, 3, padding="same", activation="relu")(x)
  x = tf.keras.layers.GlobalAveragePooling1D()(x)
  outputs = tf.keras.layers.Dense(3, activation="softmax")(x)
  model = tf.keras.Model(inputs=inputs, outputs=outputs)
  model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
  )
  return model


def main():
  start = time.time()
  log("Script started")
  parser = argparse.ArgumentParser()
  parser.add_argument("--dataset", default="ml/dataset.jsonl")
  parser.add_argument("--sequence-length", type=int, default=30)
  parser.add_argument("--epochs", type=int, default=25)
  parser.add_argument("--batch-size", type=int, default=32)
  parser.add_argument("--exports-dir", default="ml/exports")
  args = parser.parse_args()

  dataset_path = Path(args.dataset)
  exports_dir = Path(args.exports_dir)
  exports_dir.mkdir(parents=True, exist_ok=True)
  log(f"Args: dataset={dataset_path}, sequence_length={args.sequence_length}, epochs={args.epochs}, batch_size={args.batch_size}")

  log("Loading dataset...")
  x, y = load_jsonl_dataset(dataset_path, args.sequence_length)
  _, _, feature_dim = x.shape
  log(f"Building model (input: {args.sequence_length}x{feature_dim})...")
  model = build_model(args.sequence_length, feature_dim)

  callbacks = [
    tf.keras.callbacks.EarlyStopping(
      monitor="val_accuracy",
      mode="max",
      patience=5,
      restore_best_weights=True,
    )
  ]

  log("Training started")
  history = model.fit(
    x,
    y,
    validation_split=0.2,
    epochs=args.epochs,
    batch_size=args.batch_size,
    callbacks=callbacks,
    verbose=2,
    shuffle=True,
  )
  last_epoch = len(history.history.get("loss", []))
  final_acc = history.history.get("accuracy", [None])[-1]
  final_val_acc = history.history.get("val_accuracy", [None])[-1]
  log(f"Training finished after {last_epoch} epochs | acc={final_acc} | val_acc={final_val_acc}")

  keras_export = exports_dir / "gesture_model.keras"
  log(f"Saving Keras model to {keras_export} ...")
  model.save(keras_export, overwrite=True)

  log(f"Keras model saved to: {keras_export}")
  log("Next: convert to TFJS in WSL/Colab/Docker and copy to public/models/gesture_model/")
  log(f"Total runtime: {time.time() - start:.1f}s")



if __name__ == "__main__":
  main()
