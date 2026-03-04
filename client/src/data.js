// ── Participant Names (for live speaker identification) ───────────────────────
export const PARTICIPANTS = [
  "Soliel", "Ebube", "Tyriz", "Emmanuella", "Nia", "Tayler B.D", "Al-Amin", "Sidney",
];

// ── Speaker Colors (used in mock mode; live mode uses server-assigned colors) ─
export const SPEAKER_COLORS = {
  "Soliel": "#a8d8ea",
  "Ebube": "#f4b8c1",
  "Tyriz": "#c3aed6",
  "Emmanuella": "#f9e4b7",
  "Nia": "#b5ead7",
  "Tayler B.D": "#f8c8dc",
  "Al-Amin": "#c7ceea",
  "Sidney": "#ffd3b6",
};

// ── Questions (displayed on tiles) ──────────────────────────────────────────
export const QUESTIONS = [
  { id: "q1", text: "What's a value important to you, and how does it connect to AI?" },
  { id: "q2", text: "Can you share a time AI was used in a way that didn't feel right?" },
  { id: "q3", text: "Five years from now — how do you see AI in society, and what ethical questions will matter most?" },
  { id: "q4", text: "What's one thing you're taking away from today's conversation?" },
];

// ── Full question text (for server/live mode) ────────────────────────────────
export const QUESTIONS_FULL = [
  {
    id: "q1",
    text: "What's a value important to you, and how does it connect to AI?",
    fullText: "So for to ease into this conversation, I want to do a quick round of introductions so everyone share your first name and a value or core ethics that's very important to you, like fairness, creativity, or curiosity on how that connects to your feelings about AI.",
  },
  {
    id: "q2",
    text: "Can you share a time AI was used in a way that didn't feel right?",
    fullText: "Do you think AI has shifted the way that we either connect with people or our threshold around values? For example, take a moment to think about a time when you or someone you know used AI in a way that didn't feel right to you. What happened, and how did that experience impact you?",
  },
  {
    id: "q3",
    text: "Five years from now — how do you see AI in society, and what ethical questions will matter most?",
    fullText: "Imagine it is five years from now. How do you see AI being part of society, and what ethical questions or challenges do you think will matter most? If you could establish one rule or regulation regarding the use of AI, what would it be and why?",
  },
  {
    id: "q4",
    text: "What's one thing you're taking away from today's conversation?",
    fullText: "Again, what is one thing that you heard today from other people around from this conversation or around this conversation that you didn't get the chance to share that you would like other people to hear?",
  },
];

// ── Mock Sequence (30 responses, 4 questions) ────────────────────────────────
// pid = parent response ID (when a speaker explicitly references another speaker by name)
export const MOCK = [
  // Q1: Values + AI
  { id: "r1", qId: "q1", sp: "Ebube", sum: "AI dulls creativity" },
  { id: "r2", qId: "q1", sp: "Tayler B.D", sum: "AI helps you learn faster" },
  { id: "r3", qId: "q1", sp: "Al-Amin", sum: "What can you bring that AI can't?" },
  { id: "r4", qId: "q1", sp: "Tyriz", sum: "AI makes soulless creativity too easy" },
  { id: "r5", qId: "q1", sp: "Nia", sum: "Hours of work taken in two seconds" },
  { id: "r6", qId: "q1", sp: "Emmanuella", sum: "AI breaks down what professors can't" },
  { id: "r7", qId: "q1", sp: "Sidney", sum: "I had to look twice to know the bunnies weren't real" },

  // Q2: AI used wrong / scams / scary
  // Sidney's point about AI scams leads Taylor to share a connected scam story
  { id: "r8", qId: "q2", sp: "Tayler B.D", sum: "An AI grandma tricked people into a scam", pid: "r7" },
  // Tyriz responds to the scam theme with another example (no explicit callout by name)
  { id: "r9", qId: "q2", sp: "Tyriz", sum: "Companies push AI until people complain" },
  // Ebube raises echo chambers — no direct callout
  { id: "r10", qId: "q2", sp: "Ebube", sum: "AI will trap people in their own beliefs for 30 years" },
  // Nia explicitly adds to Ebube's point and brings ransomware
  { id: "r11", qId: "q2", sp: "Nia", sum: "A ransomware call using her husband's voice", pid: "r10" },
  // Soliel shares her own story in response to Nia
  { id: "r12", qId: "q2", sp: "Soliel", sum: "They used my crying voice to try to scam my mom", pid: "r11" },
  // Al-Amin responds to the whole scam thread with a policy take
  { id: "r13", qId: "q2", sp: "Al-Amin", sum: "Label AI like a trademark — but power benefits too much" },

  // Q3: Five years out — authenticity, laziness, regulation
  { id: "r14", qId: "q3", sp: "Al-Amin", sum: "The line between AI connection and real connection isn't as different as it seems" },
  { id: "r15", qId: "q3", sp: "Emmanuella", sum: "What makes a conversation authentic to begin with?" },
  // Al-Amin directly responds to Emmanuella (explicit name not used, but directly debates her)
  { id: "r16", qId: "q3", sp: "Al-Amin", sum: "Without risk and discomfort, it's just a demo", pid: "r15" },
  { id: "r17", qId: "q3", sp: "Tayler B.D", sum: "AI is making us less human and less authentic" },
  // Sidney explicitly agrees with Taylor ("I agree with Taylor. I also feel like it's making us very lazy")
  { id: "r18", qId: "q3", sp: "Sidney", sum: "Apple auto-replies so you don't even have to think", pid: "r17" },
  // Ebube builds on Sidney's laziness point (references "if you're always relying on AI")
  { id: "r19", qId: "q3", sp: "Ebube", sum: "When it's time to talk in person, you won't have those skills", pid: "r18" },
  // Tyriz explicitly disagrees with Al-Amin's earlier claim ("I actually disagree")
  { id: "r20", qId: "q3", sp: "Tyriz", sum: "AI is just natural to younger kids — like phones were to us", pid: "r14" },
  // Nia builds on the AI reliance theme
  { id: "r21", qId: "q3", sp: "Nia", sum: "People want answers now — they don't want to learn" },
  { id: "r22", qId: "q3", sp: "Tayler B.D", sum: "AI should enhance what you say, not replace it" },
  // Sidney explicitly builds on Taylor again ("I agree. And I also feel like there should be labeling")
  { id: "r23", qId: "q3", sp: "Sidney", sum: "Label AI with a little symbol — like TikTok's orange badge", pid: "r22" },
  // Al-Amin builds on both Sidney and Taylor's labeling idea
  { id: "r24", qId: "q3", sp: "Al-Amin", sum: "Make AI companies claim what their bots produce", pid: "r23" },

  // Q4: Takeaways
  // Tyriz reflects on what we talked about: personhood, character AI ("One thing is like you said personhood")
  { id: "r25", qId: "q4", sp: "Tyriz", sum: "I finally get why people talk to character AI — but it's still not real" },
  { id: "r26", qId: "q4", sp: "Tayler B.D", sum: "AI should be a tool, not a substitute for humanity" },
  // Nia references the chatbot story she told earlier ("one thing quickly that kind of draw my memory")
  { id: "r27", qId: "q4", sp: "Nia", sum: "The chatbot texts you if you stop messaging it", pid: "r21" },
  { id: "r28", qId: "q4", sp: "Sidney", sum: "Lazy, disconnected, and needs to be labeled" },
  // Al-Amin reflects on the whole conversation
  { id: "r29", qId: "q4", sp: "Al-Amin", sum: "Either way — with or without AI — you still have to put in the work" },
  // Emmanuella explicitly references Sidney ("I remember Sydney where she was talking about like the AI boss and how like not AI — it was like bunnies")
  { id: "r30", qId: "q4", sp: "Emmanuella", sum: "What really makes something authentic — human or AI?", pid: "r7" },
];

// ── Verbatim transcripts (from Transcript.md — hover overlay) ───────────────
// Lightly cleaned: removed "um", "uh", "like" (filler), but kept sentence structure/run-ons.
export const TRANSCRIPTS = {
  // Ebube - Line 23
  r1: "Yeah. Thank you. My name is Ebube Mbaku and I'm a second year at CCNY and my... Wait. Well, the question you asked about what are ethics was about AI. I would say it would be creativity as when you think about AI, it kind of dumbs you down, or I feel like it just lowers it.",

  // Tayler - Line 29
  r2: "Okay, well, I could continue. My name is Taylor and in terms of a value with AI, I think it helps with personal growth. For me at least it's pretty helpful when it comes to giving you quick answers, tools, ideas so that you could learn a little faster. Personally, I like to use it to help me study for exams, gives you quick flashcards, something that's easy to digest, communicate your thoughts more effectively. On top of that there's organization, better decision making. So yeah.",

  // Al-Amin - Line 32
  r3: "My name is Al-Amin, I'd say about that I get from AI would probably be value, especially self value or value in other people. I've realized that seeing as how you can get human ish results from non human systems makes you kind of think back on what can you bring to the table as a non AI entity and separate you from what AI is doing and how vast AI can be in terms of what it can do and how it can represent certain things.",

  // Tyriz - Line 35
  r4: "I'd like to continue it on. My name is Tyrese Newton and one thing I'd like to say that I have a very big connection to when it comes to AI is creativity. I feel like one of AI's biggest falls faults is its depth of creativity of the human mind and how it, how the more AI grows, the more easy it is for the average person to easily make something that has no soul or reason for it to exist. As opposed to a man made piece of art, a sculpture or a film or animation that takes years to create and show slight different ideas or passion behind it. I feel like that's one of the things that AI needs to be regulated on in the future.",

  // Nia - Line 44
  r5: "Okay. My name is Nia and the main value, well that I kind of want to piggyback off of is with creativity coming from someone who, coming from someone who has spent years of video editing, animation and just overall having to have consistent experience with further expanding my creativity. I feel like there are some parts of AI that although they do help kind of brainstorm ideas, there's also another side of it... I've seen a lot of cases where, whether that be fan arts or videos... I've seen people spend and even myself spend hours trying to create something, trying to create a product or just further express themselves through whatever they're creating and then two seconds later someone taking that same content and then adding AI onto it and therefore kind of losing the original purpose of what that art was intended to do. So it is definitely a little bit nerve wracking... because then it's starting to get a bit hard to try to differentiate between if a photo has AI incorporated in it or not.",

  // Emmanuella - Line 47
  r6: "Hi, my name is Emmanuel A. Coyote. I think of, I think a value that I hope closely I is creativity. I think necessarily the clarity aspect. So what I mean by that is that usually when I personally use AI, I use it to break down material because as a bio major you get really complex concepts and when you're in classes sometimes teachers don't really break down the material as well. So I feel like AI has a way of breaking down the material which makes it more clearer to use here. And I think in that of a sense it's, it's creative... everyone has different ways of learning and understanding materials... So I think necessarily a value, I think personally more whole closely it's more of the clarity aspect. But I think in itself it's still creative, you know, still being able to make multiple ways for users to learn material.",

  // Sidney - Line 59
  r7: "Hi, I'm Sydney and like Ella was saying before, I do feel like AI is very useful when it comes to studying, especially as a pre med major. Sometimes I find myself putting my PowerPoints, you know, because a lot of professors love to put a hundred million PowerPoints on one lesson. So just putting my PowerPoints in AI and having it create flashcards, practice questions, things like that. But on the downside, I do feel like AI is kind of taking over in a sense because I would scroll on TikTok and I remember clearly, I saw this video of bunnies jumping on the trampoline and I know this might sound... It might sound very random, but it really took a lot in me to realize that it was AI. So I feel like AI is kind of recreating a lot of realistic material. And especially as the older generation, they may not be able to decipher between what's real and what's not. So I do feel like that is a downside of AI.",

  // Tayler - Line 62
  r8: "The point that Sydney brought up reminded me of some Instagram scam I saw. I guess that was AI. It was essentially, I guess, this family specifically a... I guess a grandma with a grandson, I guess, begging for... Not money per se, but they were selling a product and they're like, oh, we're closing down. Whatever you guys can do to help. Because, you know, and whole time it was just AI. So it's most likely a scam to get your money and you're not going to get a product. So that's, you know, a crazy downside to AI that definitely a lot of people would fall for, especially younger people on Instagram because, you know, they see things. They like. They're like, oh, I should buy it, and, you know, they don't think twice about it.",

  // Tyriz - Line 68
  r9: "I feel like companies are willing to cross lines when it comes to AI, but they just got to keep pushing the line further and further and only retract what they did after the fact, like, oh, sorry, we need to offend anybody or make any issues, but really they just don't care. And they're trying to see how far they can really push themselves to break that line. Because you can see it in companies using AI... I think recently Aussie. Aussie Osborne passed away and then they use videos of him with AI celebrities... It's like, look, his passing away. Remember this concert and things like that. It's like, I think people just get away with anything. They can complain. And until people do complain, they might try and change things.",

  // Ebube - Line 71
  r10: "I have a comment to make about AI. I feel like with the way it's going, a lot of times it's going to force people to... It's going to force people to believe their own beliefs even stronger. As with how there's already... Social media is already pushing people to who are Republican or Democrats to even fall deeper into their beliefs without understanding other sides of view with the way AI is going and how you say you can't even know when a video is fake or not. There's going to be such things to amplify people's beliefs and with how society is becoming more separate and people are going to be alone, they're going to have less communication with different people and depend on social medias and AI is going to support their beliefs. As you've known cases where people talk to AI and ask them advice and ask them about relationships. And I feel like that's becoming even more scarier when you think what will happen in 30 years when people just talk to AI to feed into their beliefs or give them advice and you know, AI will support their beliefs. So it's just an unsafer environment.",

  // Nia - Line 74
  r11: "To add on to that. I feel like the line with AI because it's not necessarily quote unquote defined, I feel like, yet... I feel like this could be a trial run and the trial run got gone on for too long. Because there's no specific boundary or confirmed line that it may or may not cross that it kind of makes it a lot more difficult to figure out the extent that it's gonna continue to affect people. Especially going off of people using it for advice, kind of acting like some people say that they use it for therapy and stuff. But I feel like also as a cyber security major, AI is making it hard... I've seen a lot of social media postings and articles about how there's been an increase in robocalls and how this lady had gotten a call from the phone, a phone number that looked to be of her husband's, and then she answered the phone call thinking that it was him. But then they were saying, oh, they use his voice to make it seem like he had an emergency, like he was in trouble, and they were like, oh, can you please give us a certain amount of money? It was basically a ransomware, but through phone call... So because of stuff like that and a lot of people, you know, that's gonna obviously cause panic and just emotional uproar... it just makes it a lot harder and now adds a whole other layer onto the problems that already are existing in the cyberspace. And it's just gonna continue to be our trial run. And I guess for funsies, not for us. But. Yeah.",

  // Soliel - Line 77
  r12: "That's so interesting because I also... Well, not me personally, but my mom actually, she got a call one day where they had used my voice. You know how sometimes when I get stressed or anxious, I'll start crying hysterically. And so they used that voice to kind of first introduced, like when my mom had picked up the call, that was the first thing that she had heard. And then they had tried to get her to get money. Thankfully, she went to a cop and the situation kind of diffused out of there... But my mom swears to this day that that sound of me crying is actually... No, like this is 100% true... Like, she genuinely believes that it was really my voice. So, yeah, AI is getting really, really scary in that department, especially when it comes to scams.",

  // Al-Amin - Line 92
  r13: "Stuff like that kind of makes me think that... I feel like it should be with enough time, it should be fairly easy to find a way to regulate AI in a way where they're mandated to label it as AI made. Kind of like how for a certain company logo, they'll have the trademark. I feel like stuff like that would be fairly easy, but because of how many people benefit from AI and just the fact that sometimes you can't tell it from human efforts, it makes people not want to invest into that. And then the people who have a say in that, they benefit too much to want to regulate it.",

  // Al-Amin - Line 104
  r14: "I'll try and take a look at this. I kind of feel like at first glance at the question, I would say that it seems hysterical to call it or to give it the same validity as an actual connection. But the more I think about it and the more... because they're people who get really attached to people that they've only spoken to over text messages. So if AI is really so good at mimicking real humans, then it wouldn't be crazy to say that, oh, this person can feel a genuine connection. So I think the line, I don't think it's as different as it may seem. That's all I can say. I think that we can consider it, but I wouldn't go as far as to say that it's as valid as a human to human connection.",

  // Emmanuella - Line 107
  r15: "I also think that AI lacks a lot of humanistic traits. For example, AI doesn't have physical embodiment. There are a lot of people who have a social anxiety or just in terms of being around, physically being around with others. So I think AI kind of provides that escape, to kind of talk to someone without having to be physically near them. In a sense, if you were to have a conversation with AI, AI would always be polite to you, always engaging your conversations... There's always a fear of being judged... What if you're thinking that the other person judges you or feeling that you're inconveniencing the other person because of what you're talking about... When you're talking to AI you people wouldn't necessarily have to be worrying about that. So in terms of that would understand why people are that sense, I would say that technically it's authentic... Because I believe regardless of the subject of what you're talking to... if your conversation is having all the traits of what a conversation is... and it's being wealthfully engaged... And I think it can be considered authentic even... I would even say like you write a letter, just writing to yourself or just writing about your thoughts. And that itself, that could be a conversation because you're just having introspection.",

  // Al-Amin - Line 122
  r16: "I do kind of feel as though having to deal with those aspects of social anxiety or worrying about like, oh, what X person might have to say or how and what you say might be received as part of having a genuine conversation. I feel like just being able to go about that without any of the risks is, it's, it's nothing short of a demo, you know, and you can't call a demo the full thing. Do you think, if you're doing something but you're only incorporating half of what it is, then it can only be seen as a trial run. And if you're succeeding at the trial one, then it doesn't say that you're incapable of doing the real thing. So it's not to take away from the fact that maybe talking to chatbots will actually help people with these issues and help them with person to person conversations. But I do feel like one of the first steps to having an actual conversation is being able to deal with those ifs and maybes or buts.",

  // Tayler - Line 131
  r17: "To add on. I guess just simply put, AI is making us less human and less authentic. When we start to let it do thinking for us as well as maybe your feelings. Sometimes people go into chat and be like, oh, how are we feeling today? Or what should I do? When it's like something simple that you can definitely think on for yourself, you're kind of risking losing your voice and your own thought process because a lot of people are like heavily reliant on it and it should really just be used as a tool, something to make life a little easier. But not really consume your life because that's when it becomes an issue that needs to be addressed.",

  // Sidney - Line 134
  r18: "Oh, I agree with Taylor. I also feel like it's making us very lazy because there's no reason why you're having a conversation with someone and like, let's say your response was genuinely like, you know something. Well, your response is basically how you feel, right? The person responds. With the AI generated paragraph one, you can kind of tell when something is AI sometimes because of the way how it speaks. It's not really human. Like, so I feel like a lot of times instead of like really thinking something out and expressing how you really feel, AI is basically making us lazy. We just go in ChatGPT, we put the person's response and it just pops up. Even now Apple has this new thing on the newer models where in messages actually, instead of typing out your response, they have an AI type of response thing that automatically responds to the person's message. You don't even have to think about tapping. It takes like five seconds to tap. Whereas a message actually requires somebody to think and, you know, type out a message. But nowadays it's just people just use AI because they're just lazy. They're getting lazy because they know that they don't have to think for themselves or they don't have to do the actual work.",

  // Ebube - Line 140
  r19: "I think that you actually care for your abilities to communicate with others and have real human interactions. If you're always relying on AI to generate your responses to how people interact with you, and if you're a person who relies too heavily on using AI to communicate with others, then when it comes time where you need to interact with people in person, you won't necessarily have those skills because you've been relying on AI the entire time to carry your conversations for you.",

  // Tyriz - Line 146
  r20: "I actually disagree on people stop using AI as often... because from what I've noticed on the Internet, AI is just getting better at what people wanted to do for them, like consistently just better and better. And the more to use AI, the better it gets because it learns from the data you put inside of it because it's self learning. So I feel like unfortunately people will begin to rely on AI even more over time and find more ways to use AI to get, to make things easier for them and have to work as hard... A lot of people online who are younger are growing up with AI, so it's just for them it's like kind of like how we had phones growing up. So it's just like phones are so natural to us, we just use it like it's nothing. But AI is new to us. So we're still skeptical. However they're growing up with AI so to them it's still going to be natural. So many things just like doing homework and stuff like that. They're like oh I don't need to work or study on this paper. I just use my AI bot to write this for me or give you the answers for this... But to us it's like okay, you might want to use AI sparingly and just use it only to study instead of just getting answers straight away. Like they might not have the self restraint use AI and because of that it's going to be used more and more.",

  // Nia - Line 161
  r21: "I agree with Tyriz. I was going to say that... about the part of some people now getting to the point they don't care... I've also seen it where like in some of my college classes, especially math class related, where I'll have like professors that are really wanting us just to kind of do things hands on. So like, we're going to be not really relying on technology for the majority of the course, if not, not really relying on it at all. And then there will be moments of students just being like, oh, I don't really feel like checking this to make sure that I did it right or I don't want to do it. So I'm just gonna plug it into AI or something. And I feel like the problem with it is people are choosing when they use it... when people rely on it so much now it's like, you're choosing the convenience of it without caring about or thinking about the aftermath of it... People want their answers now. They want it a lot faster. And not really wanting to be patient with learning any processes for themselves or trying to make everything as quick and transactional as possible without appreciating the beauty of learning things over time or developing those skills for yourself... Like I've seen people be like, oh, yeah, I've used AI to dictate my entire day. Like, I asked it what I should make for breakfast, what I should wear. Like, that's kind of insane. Like, can you not?",

  // Tayler - Line 174
  r22: "I guess to say something, I guess pretty short and sweet, I think, you know, AI, it should enhance what you have to say, not replace it. And not, you know. Yeah, not replace it. Not to replace it in the sense of, I guess what you're thinking or establishing a genuine human connection. So I mean, I don't know how I could regulate you using AI in your conversations. I guess I'd just say stop. But I guess in a school sense, because I think it's a really good tool. It shouldn't be eliminated because me personally, I'm going to get Chat plus for this next, this upcoming year because it's lowkey, pretty helpful and when it expires, I don't like that. But it's okay. It's a good tool. So I guess just using it as a tool and not a replacement to, you know, whatever you're trying to do. Especially if you want to do math, because Chat can't do math, just in case you didn't know that.",

  // Sidney - Line 177
  r23: "I agree. And I also feel like there should be like some type of labeling of AI generated things. Like, I know on TikTok sometimes they have a little orange sign at the bottom, really small that says AI generated or whatever. I think that that should be like implemented into AI stuff, especially different videos you see. You should probably see a little AI little symbol just to let people know that this is not real. And also, I forgot what I was going to say. Oh, in schools too, like Taylor was saying, I don't think that AI is a bad thing, but it shouldn't be used to replace your original thought. So like, if your pa, like AI assisted. I know one of my professors actually did this. Like they said we could use AI. We just have to cite our sources in a sense. Just say that it's AI or it has some parts from AI. So just like that and just labeling AI for what it is instead of masking it and making people fall for things because they think it's real or it looks realistic.",

  // Al-Amin - Line 189
  r24: "I think I'm trying to draw a connection between. Because the way I kind of try and think of AI because we've never really had anything as big and I guess cost effective to effectiveness since oil or fossil fuels or something. I kind of think like the Internet versus the library. Like, how can we... how did they try and fix the Internet in a way where it can handle its own value, but not completely overtake a library, even though it kind of is. But the only thing I can really come up with is AI companies kind of trying to claim what their bots are making. I feel like it would make sense. I feel like the most neutral way to kind of go about it where you're not benefiting one side over the other is to just have AI companies try and claim or claim their AI algorithms or claim, claim what their AI bots are making. So that way not only will they kind of be on board with it because they'll be benefiting from it, but people will be a little bit more hesitant to use it because not only will people know that it's AI, but they'll be attributing their work to that company, which not a lot of people like to do and things of that nature. I think that's kind of the best I can really come up with. Again with the trade or with the labeling things as AI. Just having that full transparency of knowing what is AI and not have it replace human, human efforts is the ultimate goal.",

  // Tyriz - Line 213
  r25: "One thing is like you said personhood. And so we were talking about a people talking to AI. Like subtleties behind why people do it and what causes it in the first place and people not being able to develop social skills for AI. That was really interesting. I never really thought about. I've always had a negative perspective on it. Like I never understood why would want to speak to a character AI of like a micro favorite, like anime or something like that, or video games or TV show like this. People try to connect to some type of human like thing so they don't feel like from the man your society. But I still feel like it's still not the best choice when it comes to learning how to develop, learning how to talk to people. Because at the end of the day it's still not a real conversation, like a real relationship. Like you're making a relationship like this doesn't ask for care about you back. It's just getting the best response possible based on what you said. So I still feel like it's the wrong way to go about things.",

  // Tayler - Line 216
  r26: "My main takeaway. I mean it's just what I've been saying all this time. AI should be a tool, not a substitute for humanity. And you know, some clear boundaries should be set. Like you know, I don't know, just be a normal person. Life should just revert to how it was before the pandemic. I feel like this is where the AI downfall really came from. But I mean, yeah, like it's a useful tool. Let's keep it as such, not your whole livelihood because that's when you start to lose yourself.",

  // Nia - Line 219
  r27: "Wait, wait, wait. Your, your, your motions distracting. Sorry. But yeah, I think on the, on a similar note, I feel like, well, one thing really quickly that kind of draw my memory about the whole chatbot apps with characters and stuff. Like because of how that's developing like... like that they've also kind of learned to adapt to other interactions. Like for example, if you don't message the chatbot for a certain amount of time, they will send you a message and be like, hey, why haven't you been talking to me? Like just random stuff. Like that's kind of insane. But anyway, back to the end all know... I feel like it's good to know... like we're on similar basis, of establishing the use of AI as a tool. Because there are others where like, I know will completely not really want to engage or support a person based on if they use AI or not. And I mean like, you know, everyone has their reasons for everything. I just feel like it's... It really should just be. It's literally just what Taylor said it. Yeah, just, just. I feel like with your own discretion and with be an add on rather than take up your entire life and personality and. Yeah.",

  // Sidney - Line 222
  r28: "So there's like a couple things that I've taken away. One is that AI is making people very lazy. People think that they have to use AI for everything, even like basic functions, like what I should eat today. Like, I feel like, you know, as a human being, you shouldn't be asking a robot or an AI generated chat bot what you should be eating. You should just be, you know, eating healthy, you know. But other than that, another thing is like AI not being able to replace that human connection that people had before the pandemic or before AI began to get very popular. Because I feel like AI has been around for a while. It was just not like as popular as what we know AI to be today. And then third, my final point that I took away is that if somebody is to use AI, they shouldn't abuse it. So like Taylor said, use it as a tool and not like a substitution for human interaction or a substitute for thinking for yourself or, you know, things like that. And also like, I feel like if we do use AI, it should be somewhat labeled as AI. So a lot of like the older generation don't get fooled, especially with these TikTok videos and stuff like that. They do look very realistic. So I feel like a lot of people should label when something is AI or cite their sources when they use AI especially in schools because I don't believe it's a bad thing.",

  // Al-Amin - Line 246
  r29: "I'll take the. I'll take the mic. I would just say that I'd. After talking about this because I haven't really. I've talked to people about AI, but not in depth or not in a progressive way where it's like, where do we go from here? But I'd say that at least for me, I've realized that I... If, if you're gonna use it, then you have to. To get the most out of it, you still have to put in a considerable amount of work to just to at least be able to see what it's, what it's capable of. You have to put it in a considerable amount of work. And if you're not going to use it, then you still have to put in a considerable amount of work so you can stand out among the slurry of AI things. So at least in terms of the workforce... If, let's say you want to use AI to tweak your resume or to make a cover letter, it would be best to either make your... Make it yourself and make it so original or so unique or so genuine to the point where just like, yeah, nah, this is, this is a person right here. Like, this is a flesh human being who has dreams and aspirations or use AI to make it really top of the bar. Use it in a way where you can take out any imperfections with it. To the point where they can say like, oh, yeah, like this is a good candidate.",

  // Emmanuella - Line 260
  r30: "Okay, so I have a lot to reflect on. I think one of the most interesting topics that I heard was just like, having authentic conversation with AI itself and how far it has gotten in today's world. Specifically, I remember I saw Nia and Taylor talking about in the comments... about how someone fell in love with their... I'm sorry, it was Sydney where she was talking about the bunnies jumping on a trampoline. And it was just interesting to realize how far AI has come. And I think one specific thing that I really liked in this conversation was just talking about, like, whether you can have authentic conversation with AI because... we talked about how AI can act really engaging in your conversations... But it's just like, having that thin line between what are humanistic characteristics and in a sense what is just a computer machine. And just like comparing those aspects between having a real conversation with a human being compared to AI Bot.",
};
