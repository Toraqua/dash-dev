/**
 * useDeviceCapability - Deteccao profissional de capacidade do dispositivo.
 *
 * Tecnica: CSS Interaction Media Features (W3C Spec).
 * Ref: https://www.w3.org/TR/mediaqueries-4/#mf-interaction
 *
 * `pointer: coarse` = entrada primaria e imprecisa (dedo, touch)
 * `pointer: fine`   = entrada primaria e precisa (mouse, trackpad)
 * `any-pointer: coarse` = dispositivo TEM alguma entrada imprecisa (hibridos)
 *
 * Por que NAO usar outras abordagens:
 *   - navigator.maxTouchPoints: retorna 0 em alguns Android WebViews
 *   - 'ontouchstart' in window: presente em browsers desktop que emulam touch
 *   - navigator.userAgent: facil de falsificar, descontinuado
 *   - window.innerWidth: detecta TAMANHO, nao CAPACIDADE de entrada
 *   - (hover: none): iPads iOS 13+ reportam hover como 'conditional', nao 'none'
 *
 * Suporte: >97% dos browsers modernos (Chrome 41+, Firefox 41+, Safari 9+).
 */
import { useState, useEffect } from 'react';

function readCapability() {
  if (typeof window === 'undefined') {
    return { isTouch: false, isHybrid: false, isFine: true };
  }
  const primaryCoarse = window.matchMedia('(pointer: coarse)').matches;
  const anyCoarse     = window.matchMedia('(any-pointer: coarse)').matches;
  const primaryFine   = window.matchMedia('(pointer: fine)').matches;
  return {
    isTouch:  primaryCoarse,
    isHybrid: anyCoarse && primaryFine,
    isFine:   primaryFine && !anyCoarse,
  };
}

/**
 * Detecta a capacidade de entrada do dispositivo via CSS Media Query.
 * Reativo: atualiza se o usuario conectar/desconectar um mouse.
 *
 * @returns {{ isTouch: boolean, isHybrid: boolean, isFine: boolean }}
 */
export function useDeviceCapability() {
  const [capability, setCapability] = useState(readCapability);

  useEffect(() => {
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const mqFine   = window.matchMedia('(pointer: fine)');
    const onChange = () => setCapability(readCapability());

    if (mqCoarse.addEventListener) {
      mqCoarse.addEventListener('change', onChange);
      mqFine.addEventListener('change', onChange);
    } else {
      // Safari < 14 fallback
      mqCoarse.addListener(onChange);
      mqFine.addListener(onChange);
    }

    return () => {
      if (mqCoarse.removeEventListener) {
        mqCoarse.removeEventListener('change', onChange);
        mqFine.removeEventListener('change', onChange);
      } else {
        mqCoarse.removeListener(onChange);
        mqFine.removeListener(onChange);
      }
    };
  }, []);

  return capability;
}

/**
 * Largura da janela com atualizacao reativa ao redimensionar.
 */
export function useWindowWidth() {
  const [width, setWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1200)
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
