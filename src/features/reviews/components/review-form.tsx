"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { submitReviewAction, type ReviewState } from "../actions";

const initial: ReviewState = { ok: false };

export function ReviewForm({ token }: { token: string }) {
  const t = useTranslations("reviews");
  const [state, action] = useActionState(submitReviewAction, initial);
  const [rating, setRating] = useState(0);

  if (state.ok && state.code === "thanks") {
    return (
      <Alert variant="success" className="text-sm">
        {t("thanks")}
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="rating" value={rating} />
      <div className="flex gap-1" role="radiogroup" aria-label={t("rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n}`}
            aria-checked={rating === n}
            role="radio"
            onClick={() => setRating(n)}
            className={`text-3xl leading-none ${n <= rating ? "text-amber-500" : "text-muted-foreground/40"}`}
          >
            ★
          </button>
        ))}
      </div>
      <Textarea name="comment" rows={4} maxLength={1000} placeholder={t("commentPlaceholder")} />
      {state.code && !state.ok && (
        <Alert variant="destructive" className="text-sm">
          {t.has(`err.${state.code}`) ? t(`err.${state.code}`) : t("err.generic")}
        </Alert>
      )}
      <Button type="submit" disabled={rating === 0}>
        {t("submit")}
      </Button>
    </form>
  );
}
