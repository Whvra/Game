package com.example.game.model;

public class GameResult {

    private int score;
    private int totalScore;
    private String mode;
    private String detail;

    public GameResult() {
    }

    public GameResult(int score, int totalScore, String mode, String detail) {
        this.score = score;
        this.totalScore = totalScore;
        this.mode = mode;
        this.detail = detail;
    }

    public int getScore() {
        return score;
    }

    public void setScore(int score) {
        this.score = score;
    }

    public int getTotalScore() {
        return totalScore;
    }

    public void setTotalScore(int totalScore) {
        this.totalScore = totalScore;
    }

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public String getDetail() {
        return detail;
    }

    public void setDetail(String detail) {
        this.detail = detail;
    }
}
