let params = new URLSearchParams(window.location.search);
let subject = params.get("subject") || localStorage.getItem("subject") || "english";

console.log("Selected subject:", subject);

let allQuestions = {
    english: englishQuestions,
    math: mathQuestions,
    physics: physicsQuestions,
    chemistry: chemistryQuestions,
    biology: biologyQuestions,
    government: governmentQuestions,
    literature: literatureQuestions,
    crs: crsQuestions,
    account: accountQuestions,
    commerce: commerceQuestions,
    economics: economicsQuestions
};

let questions = allQuestions[subject] || [];

let currentQuestion = 0;
let score = 0;
let time = 60;

// store answers
let userAnswers = new Array(questions.length).fill(null);

function loadQuestion() {
    const q = questions[currentQuestion];

    document.getElementById("question").innerText =
        `${currentQuestion + 1}/${questions.length}: ${q.question}`;

    const answersDiv = document.getElementById("answers");
    answersDiv.innerHTML = "";

    q.answers.forEach((answer, index) => {
        const btn = document.createElement("button");
        btn.innerText = answer;

        // highlight selected
        if (userAnswers[currentQuestion] === index) {
            btn.style.background = "#2980b9";
        }

        btn.onclick = () => {
            userAnswers[currentQuestion] = index;
            loadQuestion();
        };

        answersDiv.appendChild(btn);
    });
}

// NEXT
document.getElementById("nextBtn").onclick = () => {
    if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        loadQuestion();
    } else {
        finishExam();
    }
};

// PREVIOUS
document.getElementById("prevBtn").onclick = () => {
    if (currentQuestion > 0) {
        currentQuestion--;
        loadQuestion();
    }
};

// FINISH
function finishExam() {
    score = 0;

    questions.forEach((q, i) => {
        if (userAnswers[i] === q.correct) {
            score++;
        }
    });

    localStorage.setItem("score", score);
    localStorage.setItem("total", questions.length);

    let results = JSON.parse(localStorage.getItem("results")) || [];

    results.push({
        name: localStorage.getItem("studentName"),
        id: localStorage.getItem("studentId"),
        subject: subject,
        score: score,
        total: questions.length
    });

    localStorage.setItem("results", JSON.stringify(results));

    window.location.href = "result.html";
}

// TIMER
let timer = setInterval(() => {
    time--;
    document.getElementById("timer").innerText = "Time: " + time;

    if (time <= 0) {
        clearInterval(timer);
        finishExam();
    }
}, 1000);

// START
loadQuestion();