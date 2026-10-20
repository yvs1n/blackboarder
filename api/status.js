export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';

  return res.status(200).json({
    ok: true,
    platform: 'Vercel Serverless',
    mobileUrl: `${proto}://${host}`,
    feedUrl: `${proto}://${host}/feed.ics`,
    webcalUrl: `webcal://${host}/feed.ics`
  });
}
