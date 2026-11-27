import { Heart } from "lucide-react";
import { Fragment } from "react";

export default function HeartText({ text }: { text: string }) {
  return text.split(/(하트|♥)/u).map((part, index) =>
    part === "하트" || part === "♥"
      ? <Heart key={index} className="inline-heart" fill="currentColor" role="img" aria-label="하트" />
      : <Fragment key={index}>{part}</Fragment>);
}
