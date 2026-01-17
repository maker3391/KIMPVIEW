document.getElementById('lossPercent').addEventListener('input', function() {

    let rawValue = this.value.replace(/[^0-9.]/g, ''); 
    
    const parts = rawValue.split('.');
    if (parts.length > 2) {
        rawValue = parts[0] + '.' + parts.slice(1).join('');
    }

    this.value = rawValue;

    const lossPercent = parseFloat(rawValue);

    if (!isNaN(lossPercent) && lossPercent > 0 && lossPercent < 100) {
        const recoveryRate = (lossPercent / (100 - lossPercent)) * 100;
        
        document.getElementById('recoveryRate').value = recoveryRate.toFixed(2) + '%';
    } else {
        document.getElementById('recoveryRate').value = '';
    }
});

document.getElementById('lossPercent').addEventListener('blur', function() {
    if (this.value !== '' && !this.value.includes('%')) {
        this.value = this.value + '%';
    }
});

document.getElementById('lossPercent').addEventListener('focus', function() {
    this.value = this.value.replace('%', '');


document.getElementById('lossPercent').addEventListener('input', function() {

    let rawValue = this.value.replace(/[^0-9.]/g, ''); 
    const parts = rawValue.split('.');
    if (parts.length > 2) rawValue = parts[0] + '.' + parts.slice(1).join('');
    this.value = rawValue;

    const lossPercent = parseFloat(rawValue);
    const errorMsg = document.getElementById('errorMsg');
    const recoveryInput = document.getElementById('recoveryRate');

    if (!isNaN(lossPercent)) {
        if (lossPercent <= 0 || lossPercent >= 100) {

            errorMsg.style.display = 'block';
            recoveryInput.value = ''; 
        } else {

            errorMsg.style.display = 'none';
            const recoveryRate = (lossPercent / (100 - lossPercent)) * 100;
            recoveryInput.value = recoveryRate.toFixed(2) + '%';
        }
    } else {

        errorMsg.style.display = 'none';
        recoveryInput.value = '';
    }
});
});