"use client";

interface AdBannerProps {
  width: number;
  height: number;
  adKey: string;
}

export default function AdBanner({ width, height, adKey }: AdBannerProps) {
    const htmlContent = `<!DOCTYPE html>
<html>
<head><style>body{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head>
<body>
<script type="text/javascript">
  atOptions = {
    'key' : '${adKey}',
    'format' : 'iframe',
    'height' : ${height},
    'width' : ${width},
    'params' : {}
  };
</script>
<script type="text/javascript" src="https://www.highperformanceformat.com/${adKey}/invoke.js"></script>
</body>
</html>`;
  const src = "data:text/html;charset=utf-8," + encodeURIComponent(htmlContent);
  
  return (
    <div style={{ width, height, margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' }}>
      <iframe 
        src={src} 
        width={width} 
        height={height} 
        frameBorder="0" 
        scrolling="no" 
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        style={{ border: 'none', overflow: 'hidden' }}
      />
    </div>
  );
}
