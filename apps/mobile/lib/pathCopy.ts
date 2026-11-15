/** Hindi for the path stages and starters. The server sends English only (services/api paths_data.py);
 * this maps that exact English text to Hindi, so a stage the server later rewords simply shows the new
 * English until it is added here. Only the stages open at launch (UPSC and the general three) are done. */
import type { Locale } from '@/lib/i18n';

const HI: Record<string, string> = {
  // UPSC
  'Foundation days': 'शुरुआती दिन',
  'First year in — finding your feet.': 'पहला साल — अपने पैर जमाने का वक़्त।',
  "I don't know if I'm studying the right way.": 'पता नहीं कि मेरी पढ़ाई का तरीका सही है या नहीं।',
  'Everyone seems ahead of me.': 'सब मुझसे आगे लगते हैं।',
  "I'm scared I chose the wrong optional.": 'डर है कि मैंने ग़लत वैकल्पिक विषय चुन लिया।',
  'Deep in preparation': 'तैयारी के बीच में',
  'The long middle — where it gets heavy.': 'लंबा बीच का दौर — जहाँ सब भारी लगने लगता है।',
  "I'm exhausted and the syllabus never ends.": 'थकान हो गई है और पाठ्यक्रम ख़त्म ही नहीं होता।',
  "My family doesn't understand this journey.": 'मेरे घरवाले इस सफ़र को नहीं समझते।',
  'I feel guilty whenever I rest.': 'आराम करते ही मन में अपराधबोध होने लगता है।',
  'The wait after prelims': 'प्रीलिम्स के बाद का इंतज़ार',
  'The strange quiet between paper and result.': 'परीक्षा और नतीजे के बीच की अजीब ख़ामोशी।',
  'I keep recalculating my marks.': 'मन में बार-बार अपने नंबरों का हिसाब चलता रहता है।',
  "My friends think they cleared. I don't.": 'मेरे दोस्तों को लगता है कि वे निकल गए। मुझे नहीं लगता।',
  "I can't start studying again until the result.": 'नतीजे आने तक दोबारा पढ़ाई शुरू करने का मन नहीं बनता।',
  'Mains territory': 'मेन्स का दौर',
  'Written the battle, or writing it now.': 'लड़ाई लिख चुके हैं, या अभी लिख रहे हैं।',
  'Mains drained everything out of me.': 'मेन्स ने मुझे अंदर से खाली कर दिया।',
  "I don't know what to do with myself now.": 'अब समझ नहीं आता कि ख़ुद का क्या करूँ।',
  "What if all this writing wasn't enough?": 'अगर इतना लिखना भी काफ़ी नहीं निकला तो?',
  'The interview wait': 'इंटरव्यू का इंतज़ार',
  "So close — and somehow that's the hardest part.": 'मंज़िल इतनी पास — और फिर भी यही हिस्सा सबसे मुश्किल लगता है।',
  "I'm anxious about the interview.": 'इंटरव्यू को लेकर घबराहट हो रही है।',
  'I want to practice talking to someone.': 'किसी से बात करके अभ्यास करना है।',
  'The waiting is worse than the exam.': 'इंतज़ार परीक्षा से भी ज़्यादा भारी है।',
  'After a setback': 'झटके के बाद',
  "A result didn't go your way. You're still here.": 'नतीजा आपके मन का नहीं आया। फिर भी आप यहाँ हैं।',
  "The result came and it wasn't mine.": 'नतीजा आया और उसमें मेरा नाम नहीं था।',
  "I don't know whether to try again.": 'समझ नहीं आता कि दोबारा कोशिश करूँ या नहीं।',
  "Everyone keeps asking me what's next.": 'सब पूछते रहते हैं कि आगे क्या।',
  // General
  'Heavy days': 'भारी दिन',
  "When it's just a lot right now.": 'जब बस इस वक़्त सब कुछ बहुत ज़्यादा लगे।',
  'Today felt heavy.': 'आज का दिन भारी लगा।',
  "I haven't said this out loud to anyone.": 'यह बात मैंने अब तक किसी से ज़ोर से नहीं कही।',
  "I'm okay, but I'm also not.": 'मैं ठीक हूँ, और ठीक नहीं भी हूँ।',
  'At a crossroads': 'दोराहे पर',
  'Career, courses, big decisions.': 'करियर, कोर्स, बड़े फ़ैसले।',
  "I don't know which way to go next.": 'समझ नहीं आता कि आगे किस तरफ़ जाऊँ।',
  'Everyone has an opinion about my life.': 'मेरी ज़िंदगी पर हर किसी की अपनी राय है।',
  'How did you decide what to do?': 'आपने कैसे तय किया कि क्या करना है?',
  'Open door': 'खुला दरवाज़ा',
  'No agenda. Just a conversation.': 'कोई मक़सद नहीं। बस एक बातचीत।',
  'I just want to talk to someone.': 'बस किसी से बात करनी है।',
  'Tell me it gets lighter.': 'बताइए कि सब हल्का हो जाता है।',
};

/** The text to show for a server-sent stage title, blurb or starter. */
export function pathCopy(locale: Locale, english: string): string {
  return (locale === 'hi' && HI[english]) || english;
}

export const PATH_COPY_HI = HI;
