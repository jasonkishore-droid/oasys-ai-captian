import { useMemo } from 'react';
import { qrSvgPath } from './upi';

// Black-on-white QR as SVG; stays sharp on screen and in browser print.
export default function UpiQr({ link, size = 148, label }) {
  const qr = useMemo(() => { try { return qrSvgPath(link); } catch { return null; } }, [link]);
  if (!qr) return null;
  const pad = 2;
  return (
    <svg className="upi-qr" width={size} height={size} viewBox={`${-pad} ${-pad} ${qr.size + pad * 2} ${qr.size + pad * 2}`}
      role="img" aria-label={label || 'UPI payment QR code'} shapeRendering="crispEdges">
      <rect x={-pad} y={-pad} width={qr.size + pad * 2} height={qr.size + pad * 2} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}
