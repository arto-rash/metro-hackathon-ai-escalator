export interface SignalInfo {
  label: string;
  description: string;
}

export const SIGNAL_INFO: Record<string, SignalInfo> = {
  fall: {
    label: "Fell / Collapsed",
    description: "Person fell or collapsed on the escalator",
  },
  sitting: {
    label: "Sitting on step / railing",
    description: "Sürahinin üstündə oturmaq — sitting on the escalator step or railing (qadağandır)",
  },
  counterflow: {
    label: "Moving against direction",
    description: "Eskalatorda əks istiqamətdə hərəkət — moving opposite to escalator direction",
  },
  facing_back: {
    label: "Facing backwards",
    description: "Person is facing the wrong way on the escalator",
  },
  running: {
    label: "Running on escalator",
    description: "Eskalatorda qaçmaq qadağandır — person running on the escalator",
  },
  stuff: {
    label: "Unattended bag / item",
    description: "Nəzarətsiz əşya — bag or item left unattended on escalator; throwing items also flagged",
  },
  density: {
    label: "Overcrowding",
    description: "Too many people on the escalator at once — capacity exceeded",
  },
};
