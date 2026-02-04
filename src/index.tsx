import React, { createContext, useContext, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

// --- Types ---

export type TranslationCallback = (translatedText: string) => void;

interface BridgeState {
  register: (value: string, onChange: TranslationCallback) => string;
  unregister: (id: string) => void;
  updateValue: (id: string, newValue: string) => void;
}

// --- Core Logic: MirrorManager ---

class MirrorManager {
  private container: HTMLDivElement;
  private observers: Map<string, TranslationCallback> = new Map();
  private mutationObserver: MutationObserver;

  constructor() {
    // 1. Light DOM에 숨겨진 미러 컨테이너 생성
    this.container = document.createElement('div');
    this.container.id = 'shadow-translate-bridge-mirror';
    
    // 구글 번역기가 인식하도록 "화면에는 안 보이지만 렌더링은 되는" 스타일 적용
    // display: none은 번역 대상에서 제외될 수 있음
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
    
    // Body에 주입 (Web Component 외부인 Light DOM에 위치해야 함)
    if (!document.getElementById('shadow-translate-bridge-mirror')) {
        document.body.appendChild(this.container);
    } else {
        this.container = document.getElementById('shadow-translate-bridge-mirror') as HTMLDivElement;
    }

    // 2. 통합 MutationObserver 설정
    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
           // 텍스트 변경이 일어난 노드 추적
           // mutation.target은 텍스트 노드일 수 있으므로 parentElement 확인 필요
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
    // 번역기가 문맥을 파악하기 쉽게 block 요소처럼 처리하거나 구분자 추가 가능
    el.style.display = 'block'; 
    
    this.container.appendChild(el);

    return id;
  }

  updateValue(id: string, newValue: string) {
    const el = this.container.querySelector(`[data-mirror-id="${id}"]`) as HTMLElement;
    // 불필요한 DOM 조작 방지
    if (el && el.innerText !== newValue) {
      el.innerText = newValue;
    }
  }

  unregister(id: string) {
    this.observers.delete(id);
    const el = this.container.querySelector(`[data-mirror-id="${id}"]`);
    el?.remove();
  }
  
  // Clean up if needed (앱 종료 시 등)
  disconnect() {
      this.mutationObserver.disconnect();
      this.container.remove();
  }
}

// --- React Context ---

const BridgeContext = createContext<BridgeState | null>(null);

export const TranslationBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Singleton instance 유지
  const manager = useMemo(() => new MirrorManager(), []);

  const api = useMemo(() => ({
    register: (val: string, cb: TranslationCallback) => manager.register(val, cb),
    unregister: (id: string) => manager.unregister(id),
    updateValue: (id: string, val: string) => manager.updateValue(id, val),
  }), [manager]);

  return <BridgeContext.Provider value={api}>{children}</BridgeContext.Provider>;
};

// --- Hook ---

export const useShadowTranslation = (value: string, onChange: TranslationCallback) => {
  const bridge = useContext(BridgeContext);
  const idRef = useRef<string | null>(null);

  if (!bridge) {
    console.warn('useShadowTranslation must be used within a TranslationBridgeProvider');
    return;
  }

  useEffect(() => {
    // 1. 컴포넌트 마운트 시 등록
    idRef.current = bridge.register(value, onChange);

    return () => {
      // 3. 언마운트 시 해제
      if (idRef.current) bridge.unregister(idRef.current);
    };
  }, []); // 의존성 배열 비움: 등록/해제는 한 번만

  useEffect(() => {
    // 2. 내부 텍스트(value)가 변경되면 미러 DOM 업데이트 -> 번역기 재동작 유도
    if (idRef.current) {
      bridge.updateValue(idRef.current, value);
    }
  }, [value, bridge]);
};