import { useEffect, useRef, useState } from 'react';
import { authIntroMessages } from './auth-intro-copy.js';
import './auth-intro.css';

const services = ['electricity', 'savings', 'solar', 'consult'] as const;

export function AuthIntro({ locale, slogan }: { locale: 'en' | 'fa'; slogan?: string | null }) {
  const copy = authIntroMessages[locale];
  const scene = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = active === services.length - 1;
  const finished = last && !playing;
  const service = services[active]!;

  useEffect(() => {
    if (!scene.current || !playing || typeof IntersectionObserver === 'undefined') return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let timer: number;
    const schedule = () => {
      clearTimeout(timer);
      if (visible && !media.matches) {
        timer = window.setTimeout(() => {
          if (last) setPlaying(false);
          else setActive(active + 1);
        }, 3_000);
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = (entry?.intersectionRatio ?? 0) >= 0.45;
        schedule();
      },
      { threshold: 0.45 }
    );
    observer.observe(scene.current);
    media.addEventListener('change', schedule);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', schedule);
      clearTimeout(timer);
    };
  }, [active, last, playing]);

  return (
    <aside className="auth-intro" aria-labelledby="auth-intro-title">
      <header className="auth-intro-heading">
        <p className="auth-intro-eyebrow">{slogan || copy.eyebrow}</p>
        <h2 id="auth-intro-title">
          {copy.title} <span>{copy.titleAccent}</span>
        </h2>
      </header>
      <div className="auth-intro-scene" ref={scene}>
        <div className="auth-intro-content">
          <div id="auth-intro-story" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
            <div key={service} className="auth-intro-story">
              <p className="auth-intro-category">{copy[service]}</p>
              <h3>{copy.benefits[service]}</h3>
            </div>
          </div>
          <button
            className="auth-intro-playback"
            type="button"
            onClick={() => {
              if (finished) setActive(0);
              setPlaying(!playing);
            }}
          >
            {finished ? copy.replay : playing ? copy.pause : copy.play}
          </button>
        </div>
        <div className="auth-intro-map" aria-hidden="true">
          <div className="auth-intro-dial" />
          {services.map((key, index) => (
            <div
              className="auth-intro-route"
              data-service={key}
              data-current={active === index}
              key={key}
            >
              <span className="auth-intro-beam" />
              <span className="auth-intro-node" />
            </div>
          ))}
          <span className="auth-intro-core" data-service="electricity" />
        </div>
      </div>
      <ul className="auth-intro-services" aria-label={copy.serviceNavigation}>
        {services.map((key, index) => (
          <li key={key}>
            <button
              type="button"
              data-service={key}
              aria-controls="auth-intro-story"
              aria-pressed={active === index}
              onClick={() => {
                setPlaying(false);
                setActive(index);
              }}
            >
              {copy[key]}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
