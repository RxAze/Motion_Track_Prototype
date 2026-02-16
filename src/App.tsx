import { useMemo, useRef, useState } from 'react';
import { useGestureControl } from './gesture/useGestureControl';

const shortVideos = [
  { id: 'v1', title: 'Gesture Music Mix', views: '1.2M views' },
  { id: 'v2', title: 'Hands-Free Shopping', views: '847K views' },
  { id: 'v3', title: 'No-Touch Dashboard', views: '602K views' },
];

const products = [
  { id: 'p1', name: 'Air Cursor Ring', price: '$59' },
  { id: 'p2', name: 'Haptic Band', price: '$89' },
  { id: 'p3', name: 'Gesture Hub', price: '$129' },
  { id: 'p4', name: 'Motion Light', price: '$39' },
];

export function App() {
  const [enabled, setEnabled] = useState(false);
  const [likes, setLikes] = useState(1260);
  const [cartCount, setCartCount] = useState(0);
  const [search, setSearch] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const gesture = useGestureControl({ enabled, videoRef, snapRadius: 90 });

  const enableLabel = useMemo(
    () => (enabled ? 'Disable Gesture Control' : 'Enable Gesture Control'),
    [enabled],
  );

  const filteredProducts = useMemo(
    () => products.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  return (
    <main className="page">
      <nav className="topbar">
        <h1>Motion OS Web</h1>
        <div className="topbar-actions">
          <input
            aria-label="Search products"
            placeholder="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button onClick={() => setEnabled((prev) => !prev)}>{enableLabel}</button>
        </div>
      </nav>

      <section className="status-strip" aria-live="polite">
        <span>Status: {gesture.status}</span>
        <span>{gesture.cameraReady ? 'Camera ready' : 'Camera inactive'}</span>
        <span>{gesture.scrollModeActive ? 'Open-palm scroll mode' : 'Index-pointer mode'}</span>
        <span>Cart: {cartCount}</span>
        <span>Likes: {likes}</span>
      </section>

      <section className="hero">
        <div>
          <h2>Hands-first browsing with precise click, smooth move, and palm scroll.</h2>
          <p>
            Use index finger for cursor movement and pinch/depth-touch click. Open your full palm and move hand up/down to scroll.
          </p>
          <div className="hero-actions">
            <button onClick={() => setLikes((prev) => prev + 1)}>Like</button>
            <button onClick={() => window.alert('Gesture quick action')}>Quick Action</button>
          </div>
        </div>
        <div className="camera-wrap" aria-label="Camera preview">
          <video ref={videoRef} className="camera" autoPlay muted playsInline />
        </div>
      </section>

      <section className="video-row" aria-label="Trending videos">
        {shortVideos.map((video) => (
          <article key={video.id} className="video-card">
            <strong>{video.title}</strong>
            <p>{video.views}</p>
            <button onClick={() => setLikes((prev) => prev + 10)}>Boost</button>
          </article>
        ))}
      </section>

      <section className="product-grid" aria-label="Store products">
        {filteredProducts.map((item) => (
          <article key={item.id} className="product-item">
            <h3>{item.name}</h3>
            <p>{item.price}</p>
            <button onClick={() => setCartCount((prev) => prev + 1)}>Add to cart</button>
          </article>
        ))}
      </section>

      <section className="feed" aria-label="Social feed">
        {Array.from({ length: 16 }).map((_, index) => (
          <article key={index} className="feed-item">
            <h4>Post #{index + 1}</h4>
            <p>
              Gesture-friendly content with continuous scrolling. Open palm and move hand down to scroll up, and hand up to scroll down.
            </p>
            <button onClick={() => setLikes((prev) => prev + 1)}>Like post</button>
          </article>
        ))}
      </section>

      {enabled && (
        <div
          className={`gesture-cursor ${gesture.depthTouchActive ? 'gesture-cursor-touch' : ''} ${
            gesture.scrollModeActive ? 'gesture-cursor-scroll' : ''
          }`.trim()}
          style={{ transform: `translate(${gesture.cursor.x}px, ${gesture.cursor.y}px)` }}
        />
      )}
    </main>
  );
}
