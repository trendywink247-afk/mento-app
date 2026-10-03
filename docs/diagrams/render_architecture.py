"""Render the dated architecture views; requires Pillow, no network access."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
BG = '#F5F3EE'
INK = '#20352F'
MUTED = '#596C65'
GREEN = '#276A56'
BLUE = '#416B95'
ORANGE = '#A35B36'
FONT = Path('C:/Windows/Fonts')


def font(size, bold=False):
    return ImageFont.truetype(str(FONT / ('arialbd.ttf' if bold else 'arial.ttf')), size)


def canvas(title, subtitle, tag):
    im = Image.new('RGB', (1600, 1400), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((70, 55, 350, 95), 12, fill=GREEN)
    d.text((88, 64), tag, font=font(19, True), fill='white')
    d.text((70, 119), title, font=font(48, True), fill=INK)
    d.text((70, 183), subtitle, font=font(23), fill=MUTED)
    return im, d


def box(d, xy, title, lines, color=GREEN, fill='white'):
    x, y, r, b = xy
    d.rounded_rectangle(xy, 19, fill=fill, outline=color, width=2)
    d.rounded_rectangle((x+17, y+22, x+23, b-22), 3, fill=color)
    d.text((x+40, y+23), title, font=font(26, True), fill=color)
    for i, line in enumerate(lines):
        d.text((x+40, y+67+i*32), line, font=font(22), fill=INK)


def arrow(d, pts, color=GREEN, label=None, at=None):
    d.line(pts, fill=color, width=4)
    x,y=pts[-1]; px,py=pts[-2]
    if abs(x-px)>abs(y-py):
        sign=1 if x>px else -1
        tri=[(x,y),(x-sign*13,y-7),(x-sign*13,y+7)]
    else:
        sign=1 if y>py else -1
        tri=[(x,y),(x-7,y-sign*13),(x+7,y-sign*13)]
    d.polygon(tri,fill=color)
    if label:
        tx,ty=at
        bounds=d.textbbox((tx,ty),label,font=font(19))
        d.rectangle((bounds[0]-7,bounds[1]-4,bounds[2]+7,bounds[3]+4),fill=BG)
        d.text(at,label,font=font(19),fill=color)


im,d=canvas('Mento | Current architecture', 'Verified deployment snapshot: 2 October 2026', '01  /  CURRENT STATE')
box(d,(70,250,650,390),'Member, mentor and admin clients',[
    'Web is tested; native release acceptance is open',
    'App/API requests and Stream chat connections'])
box(d,(950,250,1530,390),'Stream Chat | external provider',[
    'Carries live UI messages today',
    'Signed server-to-server safety webhooks'],BLUE)
arrow(d,[(650,310),(950,310)],BLUE,'Chat messages',(722,272))
arrow(d,[(360,390),(360,510)],GREEN,'HTTPS API',(375,439))
arrow(d,[(1120,390),(1120,455),(690,455),(690,510)],BLUE,'Production safety hooks',(735,424))
arrow(d,[(1400,390),(1400,510)],BLUE,'Staging hooks',(1235,476))

box(d,(70,510,755,980),'VPS A | PRODUCTION',[
    '129.121.122.28  |  2 CPU / ~4 GB RAM',
    '',
    'Nginx + static web',
    'Legacy FastAPI application',
    'PostgreSQL 16 + Redis 7',
    'Stream integration; no new job worker deployed',
    '',
    'API: 92b8f57a5cd3',
    'Schema: c13a0seen001',
    'Newer backend features remain in staging'])
box(d,(845,510,1530,980),'VPS B | STAGING + OPERATIONS',[
    '31.42.125.238  |  2 CPU / ~2 GB RAM',
    '',
    'Nginx / TLS: staging.mento.chat',
    'Isolated FastAPI + worker + Postgres + Valkey',
    'Separate non-production Stream application',
    'Uptime Kuma + legacy services retained',
    '',
    'Receives production database backups',
    'Fresh restore and migration drill passed',
    'Staff-network access; public signed hooks'],BLUE)
arrow(d,[(755,660),(845,660)],GREEN)
d.text((765,620),'SFTP',font=font(18,True),fill=GREEN)
arrow(d,[(845,790),(755,790)],BLUE)
d.text((765,810),'Probes',font=font(17),fill=BLUE)

box(d,(70,1070,1530,1200),'H: LOCAL DEVELOPMENT + RELEASE ARTIFACTS',[
    r'H:\Mento gpt\Mento  |  web :18081  |  API :18000  |  isolated Postgres / Valkey',
    'Local checks -> staging acceptance -> production promotion (full CI enforcement still pending)'])
arrow(d,[(1190,1070),(1190,980)],BLUE,'Deploy tested artifacts',(1210,1017))
d.text((70,1260),'VERIFIED: browser chat, recovery, age gate, live safety hooks, backup transfer and restore.',font=font(22,True),fill=GREEN)
d.text((70,1300),'OPEN: native/iOS acceptance, load limits, alert delivery, encrypted backups and release gates.',font=font(22),fill=ORANGE)
d.text((70,1342),'Two VPSs are not an automatic high-availability cluster. Own-chat backend exists; UI still uses Stream.',font=font(20),fill=MUTED)
im.save(OUT/'mento-current-architecture.png')

im,d=canvas('Mento | Desired architecture', 'Proposed growth target - gated implementation, not currently deployed', '02  /  TARGET STATE')
box(d,(440,240,1160,365),'iOS + Android + web',[
    'Member experience, mentor console and scoped admin',
    'UPSC / NEET / JEE communities; later sectors'])
box(d,(440,425,1160,540),'Protected edge + static delivery',[
    'TLS / CDN / abuse controls / load balancing'])
arrow(d,[(800,365),(800,425)])
box(d,(70,620,960,800),'Application + realtime replicas',[
    'Modular FastAPI: identity, matching, safety, journals',
    'Own-chat only after client, safety and migration gates',
    'Verified professional mentoring is a separate future domain'])
box(d,(1050,620,1530,800),'Operations + security',[
    'Metrics, traces and scoped audit',
    'Independent alerts / staff MFA',
    'Incident response and SLOs'],ORANGE)
arrow(d,[(700,540),(700,580),(515,580),(515,620)])
arrow(d,[(960,700),(1050,700)],ORANGE)
box(d,(70,875,505,1055),'PostgreSQL',[
    'Durable data / bounded pools',
    'Compatible migrations',
    'Tested recovery and failover'])
box(d,(545,875,960,1055),'Valkey',[
    'Presence and fan-out',
    'Rate limits / transient state',
    'Bounded memory'])
box(d,(1050,875,1530,1055),'Job workers',[
    'Transactional, idempotent jobs',
    'Retries / failure visibility',
    'Push through APNs / FCM'],BLUE)
arrow(d,[(285,800),(285,875)])
arrow(d,[(750,800),(750,875)])
arrow(d,[(505,960),(545,960)],BLUE)
d.rectangle((506,948,544,972),fill=BG)
# Workers consume durable jobs from Postgres; route below the database row.
arrow(d,[(285,1055),(285,1090),(1290,1090),(1290,1055)],BLUE)
box(d,(70,1150,790,1270),'Independent encrypted backup + private file storage',[
    'Separate access / key recovery / retention / deletion tests'])
box(d,(845,1150,1530,1270),'Release and verification pipeline',[
    'PR -> CI -> staging -> TestFlight -> gated release'],BLUE)
arrow(d,[(160,1055),(160,1150)])
d.text((70,1310),'SCALE BY EVIDENCE: test capacity, reliability, failure headroom and mentor coverage.',font=font(22,True),fill=GREEN)
d.text((70,1350),'Keep Stream until own-chat is accepted. Grow beyond two VPSs when measured capacity or recovery requires it.',font=font(20),fill=MUTED)
im.save(OUT/'mento-desired-architecture.png')
print('Rendered two architecture images')
