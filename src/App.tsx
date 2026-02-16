import { useMemo, useRef, useState } from 'react';
import { useGestureControl } from './gesture/useGestureControl';

const demoProducts = [
  { id: 'p-1', name: 'Air Motion Lamp', price: '$49' },
  { id: 'p-2', name: 'Gesture Speaker', price: '$89' },
  { id: 'p-3', name: 'Wave Controller', price: '$129' },
];

export function App() {
  const [enabled, setEnabled] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const onEnableText = useMemo(
    () => (enabled ? 'Disable Gesture Mode' : 'Enable Gesture Mode'),
    [enabled],
  );

  const gesture = useGestureControl({ enabled, videoRef });

  return (
    <main className="page">
      <header className="header">
        <h1>Motion Track Prototype</h1>
        <p>
          Gesture layer with camera + hand tracking via MediaPipe. Pinch or depth-touch near a highlighted target to trigger click.
          Gesture layer with camera + hand tracking via MediaPipe. Pinch near a highlighted target to trigger click.
        </p>
        <button onClick={() => setEnabled((prev) => !prev)}>{onEnableText}</button>
        <p className="status">Status: {gesture.status}</p>
      </header>

      <section className="camera-panel" aria-label="Camera preview">
        <video ref={videoRef} className="camera" autoPlay muted playsInline />
        <p>{gesture.cameraReady ? 'Camera ready' : 'Camera inactive'}</p>
      </section>

      <section className="grid" aria-label="Products">
        {demoProducts.map((item) => (
          <article className="card" key={item.id}>
            <h2>{item.name}</h2>
            <p>{item.price}</p>
            <button onClick={() => setCartCount((count) => count + 1)}>Add to cart</button>
          </article>
        ))}
      </section>

      <section className="actions">
        <a href="#" onClick={(event) => event.preventDefault()}>
          Open details
        </a>
        <button type="button">Checkout</button>
        <input type="text" placeholder="Search catalog" aria-label="Search catalog" />
        <p>Cart count: {cartCount}</p>
      </section>

      {enabled && (
        <>
          <div
            className={`gesture-cursor ${gesture.depthTouchActive ? 'gesture-cursor-touch' : ''}`.trim()}
            className="gesture-cursor"
            style={{ transform: `translate(${gesture.cursor.x}px, ${gesture.cursor.y}px)` }}
          />
          {gesture.targetRect && (
            <div
              className="target-highlight"
              style={{
                left: gesture.targetRect.left,
                top: gesture.targetRect.top,
                width: gesture.targetRect.width,
                height: gesture.targetRect.height,
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
