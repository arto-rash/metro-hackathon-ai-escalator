export interface SignalInfo {
  label: string;
  description: string;
}

export const SIGNAL_INFO: Record<string, SignalInfo> = {
  fall: {
    label: "Yıxıldı / Çökdü",
    description: "Sərnişin eskalatorda yıxıldı və ya çökdü",
  },
  sitting: {
    label: "Pillədə / sürahidə oturmaq",
    description: "Sürahinin üstündə oturmaq qadağandır",
  },
  counterflow: {
    label: "Əks istiqamətdə hərəkət",
    description: "Eskalatorun hərəkət istiqamətinə zidd hərəkət",
  },
  facing_back: {
    label: "Arxası ilə dayanır",
    description: "Sərnişin eskalatorda yanlış istiqamətə baxır",
  },
  running: {
    label: "Eskalatorda qaçmaq",
    description: "Eskalatorda qaçmaq qadağandır",
  },
  stuff: {
    label: "Nəzarətsiz çanta / əşya",
    description: "Eskalatorda nəzarətsiz qoyulmuş çanta və ya əşya",
  },
  density: {
    label: "Həddindən artıq sıxlıq",
    description: "Eskalatorda eyni anda çox sayda insan — tutum aşıldı",
  },
};
