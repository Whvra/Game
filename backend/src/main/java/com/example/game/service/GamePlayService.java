package com.example.game.service;

import com.example.game.model.GameResult;
import org.springframework.stereotype.Service;

import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class GamePlayService {

    private final Random random = new Random();
    private final AtomicInteger totalScore = new AtomicInteger();
    private volatile String lastMode = "archery";
    private volatile String lastDetail = "Aucun tir effectué.";

    public GameResult shoot(String mode) {
        if (mode == null || mode.isBlank()) {
            mode = "archery";
        }
        lastMode = mode;

        int score;
        String detail;
        if ("darts".equalsIgnoreCase(mode)) {
            score = randomDartsScore();
            detail = describeDarts(score);
        } else {
            score = random.nextInt(11);
            detail = describeArchery(score);
        }

        int total = totalScore.addAndGet(score);
        lastDetail = detail;

        return new GameResult(score, total, mode, detail);
    }

    public GameResult getStatus() {
        return new GameResult(0, totalScore.get(), lastMode, lastDetail);
    }

    private int randomDartsScore() {
        int[] values = {1, 5, 10, 15, 20, 25, 50};
        return values[random.nextInt(values.length)];
    }

    private String describeDarts(int score) {
        if (score == 50) {
            return "Bulls eye! Excellent tir de fléchettes.";
        }
        if (score >= 20) {
            return "Très bon tir en zone haute.";
        }
        if (score >= 10) {
            return "Tir moyen, tu tiens la cible.";
        }
        return "Manqué ou tir bas. Recommence.";
    }

    private String describeArchery(int score) {
        if (score >= 9) {
            return "Flèche au centre, presque parfait!";
        }
        if (score >= 6) {
            return "Bonne flèche, bien placé.";
        }
        if (score >= 3) {
            return "Flèche sur l’anneau extérieur.";
        }
        return "Flèche dans l’herbe. Oups.";
    }
}
