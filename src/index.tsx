import React, { createContext, useContext, useEffect, useRef, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export type TranslationCallback = (translatedText: string) => void;

interface BridgeState {
  register: (value: string, onChange: TranslationCallback) => string;
  unregister: (id: string) => void;
  updateValue: (id: string, newValue: string) => void;
}

class MirrorManager {
  private container: HTMLDivElement;
  private observers: Map<string, TranslationCallback> = new Map();
  private mutationObserver: MutationObserver;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'shadow-translate-bridge-mirror';
    
    Object.assign(this.container.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      borderWidth: '0',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1000'
    });
    
    if (!document.getElementById('shadow-translate-bridge-mirror')) {
        document.body.appendChild(this.container);
    } else {
        this.container = document.getElementById('shadow-translate-bridge-mirror') as HTMLDivElement;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
           let target = mutation.target as HTMLElement;
           if (target.nodeType === Node.TEXT_NODE) {
               target = target.parentElement as HTMLElement;
           }

           const id = target?.dataset?.mirrorId;
           if (id && this.observers.has(id)) {
             const translatedText = target.innerText;
             // 콜백 실행
             this.observers.get(id)!(translatedText);
           }
        }
      });
    });

    this.mutationObserver.observe(this.container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  register(value: string, onChange: TranslationCallback): string {
    const id = `stb-${uuidv4()}`;
    this.observers.set(id, onChange);

    const el = document.createElement('span');
    el.dataset.mirrorId = id;
    el.innerText = value;
    el.style.display = 'block'; 
    
    this.container.appendChild(el);

    return id;
  }

  updateValue(id: string, newValue: string) {
    const el = this.container.querySelector(`[data-mirror-id="${id}"]`) as HTMLElement;
    if (el && el.innerText !== newValue) {
      el.innerText = newValue;
    }
  }

  unregister(id: string) {
    this.observers.delete(id);
    const el = this.container.querySelector(`[data-mirror-id="${id}"]`);
    el?.remove();
  }
  
  disconnect() {
      this.mutationObserver.disconnect();
      this.container.remove();
  }
}

const BridgeContext = createContext<BridgeState | null>(null);

export const TranslationBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const manager = useMemo(() => new MirrorManager(), []);

  const api = useMemo(() => ({
    register: (val: string, cb: TranslationCallback) => manager.register(val, cb),
    unregister: (id: string) => manager.unregister(id),
    updateValue: (id: string, val: string) => manager.updateValue(id, val),
  }), [manager]);

  return <BridgeContext.Provider value={api}>{children}</BridgeContext.Provider>;
};

export const useShadowTranslation = (value: string, onChange: TranslationCallback) => {
  const bridge = useContext(BridgeContext);
  const idRef = useRef<string | null>(null);

  if (!bridge) {
    console.warn('useShadowTranslation must be used within a TranslationBridgeProvider');
    return;
  }

  useEffect(() => {
    idRef.current = bridge.register(value, onChange);

    return () => {
      if (idRef.current) bridge.unregister(idRef.current);
    };
  }, []);

  useEffect(() => {
    if (idRef.current) {
      bridge.updateValue(idRef.current, value);
    }
  }, [value, bridge]);
};

export const useTranslateBridge = (value: string) => {
  const [translated, setTranslated] = useState(value);

  useShadowTranslation(value, setTranslated);

  return translated;
};
